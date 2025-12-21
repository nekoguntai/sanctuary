/**
 * Sanctuary AI Container
 *
 * Isolated AI service that handles all AI operations in a separate security domain.
 *
 * SECURITY ARCHITECTURE:
 * - This container makes ALL external AI calls (backend never does)
 * - Only has read-only access to sanitized transaction metadata
 * - Cannot access: private keys, signing operations, database, secrets
 * - If compromised: attacker only gets transaction metadata, no sensitive data
 *
 * DATA FLOW:
 * 1. Backend receives AI request (suggest label, NL query)
 * 2. Backend forwards to this container
 * 3. This container fetches sanitized data from backend's /internal/ai/* endpoints
 * 4. This container calls external AI endpoint
 * 5. Returns suggestion to backend (user must confirm)
 */

import express, { Request, Response, NextFunction } from 'express';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, AI_REQUEST_TIMEOUT_MS } from './constants';

const app = express();
const PORT = process.env.PORT || 3100;

// Backend URL for fetching sanitized data
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';

// Generate cryptographically secure random secret if not provided
function generateSecureSecret(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

// Shared secret for config endpoint (only backend should configure AI)
// SECURITY: Always require a secret - generate one if not provided
const ENV_CONFIG_SECRET = process.env.AI_CONFIG_SECRET;
const CONFIG_SECRET = ENV_CONFIG_SECRET || generateSecureSecret();
const IS_AUTO_GENERATED_SECRET = !ENV_CONFIG_SECRET;

// AI endpoint configuration (set via API, not env for flexibility)
let aiConfig = {
  enabled: false,
  endpoint: '',
  model: '',
};

/**
 * Simple in-memory rate limiter
 * Limits requests per IP to prevent abuse
 */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes

// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let cleaned = 0;
  for (const [ip, e] of rateLimitStore.entries()) {
    if (e.windowStart < cutoff) {
      rateLimitStore.delete(ip);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[AI] Rate limit cleanup: removed ${cleaned} expired entries`);
  }
}, CLEANUP_INTERVAL_MS);

const rateLimit = (req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = rateLimitStore.get(clientIp);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    entry = { count: 1, windowStart: now };
    rateLimitStore.set(clientIp, entry);
  } else {
    // Existing window
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
      console.warn(`[AI] Rate limit exceeded for ${clientIp}`);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000),
      });
    }
  }

  next();
};

app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[AI] ${req.method} ${req.path}`);
  next();
});

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'sanctuary-ai',
    aiEnabled: aiConfig.enabled,
    aiEndpoint: aiConfig.endpoint ? '(configured)' : '(not configured)',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Configure AI endpoint
 * Called by backend when admin updates AI settings
 * Protected by shared secret to prevent unauthorized configuration
 */
app.post('/config', (req: Request, res: Response) => {
  // SECURITY: Always verify shared secret - no bypass allowed
  const providedSecret = req.headers['x-ai-config-secret'];
  if (!providedSecret || providedSecret !== CONFIG_SECRET) {
    console.warn('[AI] Unauthorized config attempt - invalid or missing secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { enabled, endpoint, model } = req.body;

  aiConfig = {
    enabled: enabled ?? aiConfig.enabled,
    endpoint: endpoint ?? aiConfig.endpoint,
    model: model ?? aiConfig.model,
  };

  console.log(`[AI] Configuration updated: enabled=${aiConfig.enabled}, model=${aiConfig.model}`);

  res.json({ success: true, config: { enabled: aiConfig.enabled, model: aiConfig.model } });
});

/**
 * Get current configuration status
 */
app.get('/config', (_req: Request, res: Response) => {
  res.json({
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    endpointConfigured: !!aiConfig.endpoint,
  });
});

/**
 * Call external AI endpoint
 */
async function callExternalAI(prompt: string, timeout = AI_REQUEST_TIMEOUT_MS): Promise<string | null> {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return null;
  }

  try {
    let endpoint = aiConfig.endpoint.trim();
    if (!endpoint.endsWith('/')) endpoint += '/';
    if (!endpoint.includes('/v1/chat/completions')) {
      endpoint = endpoint.replace(/\/$/, '') + '/v1/chat/completions';
    }

    console.log(`[AI] Calling external AI: ${endpoint}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[AI] External AI error: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      console.error('[AI] No choices in response');
      return null;
    }

    return data.choices[0].message.content.trim();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[AI] Request timeout');
    } else {
      console.error(`[AI] Request failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Backend fetch result with explicit error handling
 * SECURITY: Distinguishes between auth failures and other errors
 */
interface BackendFetchResult<T> {
  success: boolean;
  data?: T;
  error?: 'auth_failed' | 'not_found' | 'server_error' | 'network_error';
  status?: number;
}

/**
 * Fetch sanitized transaction data from backend
 * This is the ONLY data we can access - no keys, no signing, no secrets
 * SECURITY: Explicitly validates backend response before proceeding
 */
async function fetchTransactionContext(txId: string, authToken: string): Promise<BackendFetchResult<any>> {
  try {
    const response = await fetch(`${BACKEND_URL}/internal/ai/tx/${txId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    // SECURITY: Explicit status code validation
    if (response.status === 401 || response.status === 403) {
      console.warn(`[AI] Auth failed for tx context: ${response.status}`);
      return { success: false, error: 'auth_failed', status: response.status };
    }

    if (response.status === 404) {
      console.warn(`[AI] Transaction not found: ${txId}`);
      return { success: false, error: 'not_found', status: response.status };
    }

    if (!response.ok) {
      console.error(`[AI] Failed to fetch tx context: ${response.status}`);
      return { success: false, error: 'server_error', status: response.status };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error: any) {
    console.error(`[AI] Failed to fetch tx context: ${error.message}`);
    return { success: false, error: 'network_error' };
  }
}

/**
 * Fetch wallet labels from backend
 * SECURITY: Validates backend response before returning data
 */
async function fetchWalletLabels(walletId: string, authToken: string): Promise<BackendFetchResult<string[]>> {
  try {
    const response = await fetch(`${BACKEND_URL}/internal/ai/wallet/${walletId}/labels`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    // SECURITY: Explicit status code validation
    if (response.status === 401 || response.status === 403) {
      console.warn(`[AI] Auth failed for wallet labels: ${response.status}`);
      return { success: false, error: 'auth_failed', status: response.status };
    }

    if (response.status === 404) {
      return { success: false, error: 'not_found', status: response.status };
    }

    if (!response.ok) {
      return { success: false, error: 'server_error', status: response.status };
    }

    const data = await response.json() as { labels?: string[] };
    return { success: true, data: data.labels || [] };
  } catch {
    return { success: false, error: 'network_error' };
  }
}

/**
 * Fetch wallet context for NL queries
 * SECURITY: Validates backend response before returning data
 */
async function fetchWalletContext(walletId: string, authToken: string): Promise<BackendFetchResult<any>> {
  try {
    const response = await fetch(`${BACKEND_URL}/internal/ai/wallet/${walletId}/context`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    // SECURITY: Explicit status code validation
    if (response.status === 401 || response.status === 403) {
      console.warn(`[AI] Auth failed for wallet context: ${response.status}`);
      return { success: false, error: 'auth_failed', status: response.status };
    }

    if (response.status === 404) {
      return { success: false, error: 'not_found', status: response.status };
    }

    if (!response.ok) {
      return { success: false, error: 'server_error', status: response.status };
    }

    const data = await response.json();
    return { success: true, data };
  } catch {
    return { success: false, error: 'network_error' };
  }
}

/**
 * Suggest a transaction label
 *
 * INPUT: Transaction ID + auth token
 * PROCESS:
 *   1. Fetch sanitized tx data from backend (amount, direction, date - NO address, NO txid)
 *   2. Fetch existing labels in wallet
 *   3. Build prompt with sanitized data
 *   4. Call external AI
 *   5. Return suggestion (user must confirm)
 */
app.post('/suggest-label', rateLimit, async (req: Request, res: Response) => {
  const { transactionId } = req.body;
  const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

  if (!transactionId) {
    return res.status(400).json({ error: 'transactionId required' });
  }

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: 'AI is not enabled' });
  }

  // SECURITY: Fetch and validate transaction context from backend
  const txResult = await fetchTransactionContext(transactionId, authToken);

  // SECURITY: Return early with appropriate error if backend validation fails
  if (!txResult.success) {
    if (txResult.error === 'auth_failed') {
      console.warn(`[AI] Auth validation failed for suggest-label: ${txResult.status}`);
      return res.status(txResult.status || 401).json({ error: 'Authentication failed' });
    }
    if (txResult.error === 'not_found') {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    return res.status(502).json({ error: 'Failed to fetch transaction data' });
  }

  const txContext = txResult.data;

  // Fetch existing labels for context (non-critical, continue even if fails)
  const labelsResult = await fetchWalletLabels(txContext.walletId, authToken);

  // SECURITY: Check for auth failure on labels fetch too
  if (!labelsResult.success && labelsResult.error === 'auth_failed') {
    console.warn(`[AI] Auth validation failed for wallet labels: ${labelsResult.status}`);
    return res.status(labelsResult.status || 401).json({ error: 'Authentication failed' });
  }

  const existingLabels = labelsResult.success ? labelsResult.data || [] : [];

  // Build prompt with ONLY sanitized data
  // Note: We intentionally do NOT include addresses or txids in the prompt
  const prompt = `You are a Bitcoin transaction categorizer. Based on the transaction details, suggest a short label (1-4 words).

Transaction:
- Amount: ${txContext.amount} sats (${txContext.direction})
- Date: ${txContext.date}
- Existing labels in wallet: ${existingLabels.length > 0 ? existingLabels.join(', ') : 'None'}

Respond with ONLY the suggested label, nothing else.
Examples: "Exchange Deposit", "Hardware Purchase", "Salary", "Gift"`;

  const suggestion = await callExternalAI(prompt);

  if (!suggestion) {
    return res.status(503).json({ error: 'AI endpoint not available' });
  }

  // Clean up the result
  let label = suggestion.replace(/^["']|["']$/g, '').trim();
  if (label.length > 50) {
    label = label.substring(0, 50);
  }

  res.json({ suggestion: label });
});

/**
 * Natural language query
 *
 * Converts natural language to structured query
 * Returns query structure, NOT actual data (backend executes the query)
 */
app.post('/query', rateLimit, async (req: Request, res: Response) => {
  const { query, walletId } = req.body;
  const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

  if (!query || !walletId) {
    return res.status(400).json({ error: 'query and walletId required' });
  }

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: 'AI is not enabled' });
  }

  // SECURITY: Fetch and validate wallet context from backend
  const contextResult = await fetchWalletContext(walletId, authToken);

  // SECURITY: Return early with appropriate error if backend validation fails
  if (!contextResult.success) {
    if (contextResult.error === 'auth_failed') {
      console.warn(`[AI] Auth validation failed for query: ${contextResult.status}`);
      return res.status(contextResult.status || 401).json({ error: 'Authentication failed' });
    }
    if (contextResult.error === 'not_found') {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    return res.status(502).json({ error: 'Failed to fetch wallet data' });
  }

  const recentLabels = contextResult.data?.labels?.join(', ') || 'None';

  const prompt = `You are a Bitcoin wallet assistant. Convert the user's question into a structured query.

Available data:
- transactions (amount, date, type, label, confirmations)
- addresses (address, label, used, balance)
- utxos (amount, confirmations, frozen)

Recent labels used: ${recentLabels}

User question: "${query}"

Respond with ONLY valid JSON, no other text:
{
  "type": "transactions" | "addresses" | "utxos" | "summary",
  "filter": { ... },
  "sort": { "field": "...", "order": "asc" | "desc" },
  "limit": number,
  "aggregation": "sum" | "count" | "max" | "min" | null
}`;

  const result = await callExternalAI(prompt);

  if (!result) {
    return res.status(503).json({ error: 'AI endpoint not available' });
  }

  try {
    // Extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI did not return valid JSON' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ query: parsed });
  } catch {
    res.status(500).json({ error: 'Failed to parse AI response' });
  }
});

/**
 * Test AI connection
 */
app.post('/test', rateLimit, async (_req: Request, res: Response) => {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return res.json({
      available: false,
      error: 'AI not configured',
    });
  }

  const result = await callExternalAI('Say "OK"', 10000);

  res.json({
    available: result !== null,
    model: aiConfig.model,
    error: result === null ? 'AI endpoint not reachable' : undefined,
  });
});

/**
 * Detect Ollama at common endpoints
 * Returns the first working endpoint found
 */
app.post('/detect-ollama', rateLimit, async (_req: Request, res: Response) => {
  // Common Ollama endpoints to check
  const endpoints = [
    'http://host.docker.internal:11434',  // Docker for Mac/Windows
    'http://172.17.0.1:11434',             // Docker Linux bridge
    'http://localhost:11434',              // Direct localhost (unlikely from container)
    'http://ollama:11434',                 // If user has ollama container named 'ollama'
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`[AI] Checking Ollama at ${endpoint}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${endpoint}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        console.log(`[AI] Found Ollama at ${endpoint}`);
        return res.json({
          found: true,
          endpoint,
          models: data.models?.map(m => m.name) || [],
        });
      }
    } catch (error: any) {
      // Continue to next endpoint
      console.log(`[AI] No Ollama at ${endpoint}: ${error.message}`);
    }
  }

  res.json({
    found: false,
    message: 'Ollama not detected. Make sure Ollama is running on your host machine.',
  });
});

/**
 * List available models from configured endpoint
 */
app.get('/list-models', rateLimit, async (_req: Request, res: Response) => {
  if (!aiConfig.endpoint) {
    return res.status(400).json({ error: 'No AI endpoint configured' });
  }

  try {
    let endpoint = aiConfig.endpoint.trim();
    // Ensure we're hitting the Ollama API, not OpenAI-compatible endpoint
    endpoint = endpoint.replace(/\/v1\/chat\/completions$/, '').replace(/\/v1$/, '').replace(/\/$/, '');

    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch models from AI endpoint' });
    }

    const data = await response.json() as { models?: Array<{ name: string; size: number; modified_at: string }> };

    res.json({
      models: data.models?.map(m => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
      })) || [],
    });
  } catch (error: any) {
    console.error(`[AI] Failed to list models: ${error.message}`);
    res.status(502).json({ error: 'Cannot connect to AI endpoint' });
  }
});

/**
 * Pull (download) a model from Ollama
 * This is a long-running operation - returns immediately with status
 */
app.post('/pull-model', rateLimit, async (req: Request, res: Response) => {
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: 'Model name required' });
  }

  if (!aiConfig.endpoint) {
    return res.status(400).json({ error: 'No AI endpoint configured' });
  }

  try {
    let endpoint = aiConfig.endpoint.trim();
    endpoint = endpoint.replace(/\/v1\/chat\/completions$/, '').replace(/\/v1$/, '').replace(/\/$/, '');

    console.log(`[AI] Starting pull for model: ${model}`);

    // Ollama's pull endpoint streams progress - we'll just start it and return
    const response = await fetch(`${endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      signal: AbortSignal.timeout(300000), // 5 minute timeout for pull
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[AI] Pull failed: ${error}`);
      return res.status(502).json({ error: `Failed to pull model: ${error}` });
    }

    const result = await response.json() as { status?: string };
    console.log(`[AI] Pull completed for ${model}: ${result.status}`);

    res.json({
      success: true,
      model,
      status: result.status || 'completed',
    });
  } catch (error: any) {
    console.error(`[AI] Pull error: ${error.message}`);
    res.status(502).json({ error: `Pull failed: ${error.message}` });
  }
});

/**
 * Error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[AI] Error:', err.message);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`[AI] Sanctuary AI Container started on port ${PORT}`);
  console.log(`[AI] Backend URL: ${BACKEND_URL}`);
  console.log('[AI] Security: Isolated container - no DB access, no keys, read-only metadata');

  // SECURITY: Warn if using auto-generated secret
  if (IS_AUTO_GENERATED_SECRET) {
    console.warn('[AI] WARNING: AI_CONFIG_SECRET not set - using auto-generated secret');
    console.warn('[AI] WARNING: Backend must be configured with the same secret to sync config');
    console.warn(`[AI] Auto-generated secret: ${CONFIG_SECRET}`);
  } else {
    console.log('[AI] Config secret: configured via environment');
  }
});
