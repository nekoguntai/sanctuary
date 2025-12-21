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

const app = express();
const PORT = process.env.PORT || 3100;

// Backend URL for fetching sanitized data
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';

// Shared secret for config endpoint (only backend should configure AI)
const CONFIG_SECRET = process.env.AI_CONFIG_SECRET || '';

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
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute

const rateLimit = (req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = rateLimitStore.get(clientIp);

  // Clean up old entries periodically
  if (rateLimitStore.size > 1000) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    for (const [ip, e] of rateLimitStore.entries()) {
      if (e.windowStart < cutoff) {
        rateLimitStore.delete(ip);
      }
    }
  }

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
  // Verify shared secret if configured
  if (CONFIG_SECRET) {
    const providedSecret = req.headers['x-ai-config-secret'];
    if (providedSecret !== CONFIG_SECRET) {
      console.warn('[AI] Unauthorized config attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
async function callExternalAI(prompt: string, timeout = 30000): Promise<string | null> {
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
 * Fetch sanitized transaction data from backend
 * This is the ONLY data we can access - no keys, no signing, no secrets
 */
async function fetchTransactionContext(txId: string, authToken: string): Promise<any | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/internal/ai/tx/${txId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    if (!response.ok) {
      console.error(`[AI] Failed to fetch tx context: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error: any) {
    console.error(`[AI] Failed to fetch tx context: ${error.message}`);
    return null;
  }
}

/**
 * Fetch wallet labels from backend
 */
async function fetchWalletLabels(walletId: string, authToken: string): Promise<string[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/internal/ai/wallet/${walletId}/labels`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    if (!response.ok) return [];

    const data = await response.json() as { labels?: string[] };
    return data.labels || [];
  } catch {
    return [];
  }
}

/**
 * Fetch wallet context for NL queries
 */
async function fetchWalletContext(walletId: string, authToken: string): Promise<any | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/internal/ai/wallet/${walletId}/context`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
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

  // Fetch sanitized transaction context from backend
  const txContext = await fetchTransactionContext(transactionId, authToken);
  if (!txContext) {
    return res.status(404).json({ error: 'Transaction not found or access denied' });
  }

  // Fetch existing labels for context
  const existingLabels = await fetchWalletLabels(txContext.walletId, authToken);

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

  // Fetch wallet context (just labels, no sensitive data)
  const context = await fetchWalletContext(walletId, authToken);
  const recentLabels = context?.labels?.join(', ') || 'None';

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
});
