/**
 * AI Service (Backend)
 *
 * This service forwards AI requests to the isolated AI container.
 * The backend NEVER makes external AI calls directly.
 *
 * SECURITY ARCHITECTURE:
 * - Backend: Forwards requests, manages configuration, executes query results
 * - AI Container: Makes all external AI calls, receives only sanitized data
 * - Isolation: AI container cannot access DB, keys, or signing operations
 *
 * DATA FLOW:
 * 1. User requests AI feature (suggest label, NL query)
 * 2. Backend forwards to AI container
 * 3. AI container fetches sanitized data via /internal/ai/* endpoints
 * 4. AI container calls external AI
 * 5. AI container returns suggestion
 * 6. Backend returns to user (suggestions only - user must confirm)
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import { createHash } from 'crypto';

const log = createLogger('AI');

// AI container URL
const AI_CONTAINER_URL = process.env.AI_CONTAINER_URL || 'http://ai:3100';

// AI config secret for authenticating with container
const AI_CONFIG_SECRET = process.env.AI_CONFIG_SECRET || '';

/**
 * Config sync state tracking
 * SECURITY: Only sync config when it actually changes to avoid redundant requests
 */
interface ConfigSyncState {
  lastHash: string;
  lastSyncTime: number;
  syncSuccess: boolean;
}

let configSyncState: ConfigSyncState = {
  lastHash: '',
  lastSyncTime: 0,
  syncSuccess: false,
};

/**
 * Generate a hash of the config for change detection
 */
function hashConfig(config: AIConfig): string {
  const data = JSON.stringify({
    enabled: config.enabled,
    endpoint: config.endpoint,
    model: config.model,
  });
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Transaction context for label suggestions
 */
export interface TransactionContext {
  amount: number;
  direction: 'send' | 'receive';
  address?: string;
  date: Date;
  existingLabels?: string[];
}

/**
 * Natural language query result
 */
export interface QueryResult {
  type: 'transactions' | 'addresses' | 'utxos' | 'summary';
  filter?: Record<string, any>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  limit?: number;
  aggregation?: 'sum' | 'count' | 'max' | 'min' | null;
}

/**
 * AI service configuration
 */
interface AIConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

/**
 * AI Container Response Interfaces
 */
interface AIHealthResponse {
  available: boolean;
  error?: string;
}

interface AISuggestLabelResponse {
  suggestion: string | null;
}

interface AIQueryResponse {
  query: QueryResult | null;
}

interface AIDetectOllamaResponse {
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}

interface AIListModelsResponse {
  models: Array<{ name: string; size: number; modifiedAt: string }>;
  error?: string;
}

interface AIPullModelResponse {
  success: boolean;
  model?: string;
  status?: string;
  error?: string;
}

/**
 * Validate AI container response
 * @param response The response to validate
 * @param requiredFields Fields that must be present in the response
 * @returns The validated response or null if validation fails
 */
function validateResponse<T>(response: unknown, requiredFields: string[]): T | null {
  if (!response || typeof response !== 'object') {
    log.warn('Response validation failed: not an object', { response });
    return null;
  }

  for (const field of requiredFields) {
    if (!(field in response)) {
      log.warn('Response validation failed: missing field', { field, response });
      return null;
    }
  }

  return response as T;
}

/**
 * Get AI configuration from system settings
 */
async function getAIConfig(): Promise<AIConfig> {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: ['aiEnabled', 'aiEndpoint', 'aiModel'],
        },
      },
    });

    const config: AIConfig = {
      enabled: false,
      endpoint: '',
      model: '',
    };

    for (const setting of settings) {
      const key = setting.key;
      try {
        const value = JSON.parse(setting.value);
        if (key === 'aiEnabled') config.enabled = value;
        else if (key === 'aiEndpoint') config.endpoint = value;
        else if (key === 'aiModel') config.model = value;
      } catch {
        if (key === 'aiEndpoint') config.endpoint = setting.value;
        else if (key === 'aiModel') config.model = setting.value;
      }
    }

    return config;
  } catch (error) {
    log.error('Failed to get AI config', { error: String(error) });
    return {
      enabled: false,
      endpoint: '',
      model: '',
    };
  }
}

/**
 * Sync configuration to AI container
 * SECURITY: Only syncs when config actually changes (hash-based detection)
 * SECURITY: Requires AI_CONFIG_SECRET for authentication
 */
async function syncConfigToContainer(config: AIConfig, force = false): Promise<boolean> {
  const currentHash = hashConfig(config);

  // Skip sync if config hasn't changed and last sync was successful
  if (!force && configSyncState.lastHash === currentHash && configSyncState.syncSuccess) {
    return true;
  }

  // Warn if no secret is configured
  if (!AI_CONFIG_SECRET) {
    log.warn('AI_CONFIG_SECRET not set - config sync will be rejected by container');
  }

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AI-Config-Secret': AI_CONFIG_SECRET,
      },
      body: JSON.stringify({
        enabled: config.enabled,
        endpoint: config.endpoint,
        model: config.model,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const success = response.ok;

    // Update sync state
    configSyncState = {
      lastHash: currentHash,
      lastSyncTime: Date.now(),
      syncSuccess: success,
    };

    if (!success) {
      log.error('Failed to sync config to AI container', { status: response.status });
    } else {
      log.info('AI config synced to container');
    }

    return success;
  } catch (error) {
    log.error('Failed to sync config to AI container', { error: String(error) });
    configSyncState.syncSuccess = false;
    return false;
  }
}

/**
 * Force sync configuration to AI container
 * Called when admin updates AI settings
 */
export async function forceSyncConfig(): Promise<boolean> {
  const config = await getAIConfig();
  return syncConfigToContainer(config, true);
}

/**
 * Check if AI is enabled in settings
 */
export async function isEnabled(): Promise<boolean> {
  const config = await getAIConfig();
  return config.enabled && !!config.endpoint && !!config.model;
}

/**
 * Check if AI container is available
 */
export async function isContainerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check AI endpoint health
 */
export async function checkHealth(): Promise<{
  available: boolean;
  model?: string;
  endpoint?: string;
  containerAvailable?: boolean;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.enabled) {
    return {
      available: false,
      error: 'AI is disabled in settings',
    };
  }

  if (!config.endpoint || !config.model) {
    return {
      available: false,
      error: 'AI endpoint or model not configured',
    };
  }

  // Check if AI container is available
  const containerAvailable = await isContainerAvailable();
  if (!containerAvailable) {
    return {
      available: false,
      model: config.model,
      endpoint: config.endpoint,
      containerAvailable: false,
      error: 'AI container is not available',
    };
  }

  // Sync config and test connection
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        available: false,
        model: config.model,
        endpoint: config.endpoint,
        containerAvailable: true,
        error: 'AI container test failed',
      };
    }

    const json = await response.json();
    const result = validateResponse<AIHealthResponse>(json, ['available']);

    if (!result) {
      return {
        available: false,
        model: config.model,
        endpoint: config.endpoint,
        containerAvailable: true,
        error: 'Invalid response from AI container',
      };
    }

    return {
      available: result.available,
      model: config.model,
      endpoint: config.endpoint,
      containerAvailable: true,
      error: result.error,
    };
  } catch (error) {
    return {
      available: false,
      model: config.model,
      endpoint: config.endpoint,
      containerAvailable: true,
      error: 'Failed to test AI connection',
    };
  }
}

/**
 * Suggest a transaction label
 *
 * Forwards request to AI container, which:
 * 1. Fetches sanitized tx data from /internal/ai/tx/:id
 * 2. Calls external AI
 * 3. Returns suggestion
 */
export async function suggestTransactionLabel(
  transactionId: string,
  authToken: string
): Promise<string | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Sync config to container
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/suggest-label`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      log.error('AI label suggestion failed', { status: response.status, error: error?.error });
      return null;
    }

    const json = await response.json();
    const result = validateResponse<AISuggestLabelResponse>(json, ['suggestion']);

    if (!result) {
      log.error('Invalid response from AI container for label suggestion');
      return null;
    }

    return result.suggestion || null;
  } catch (error) {
    log.error('AI label suggestion error', { error: String(error) });
    return null;
  }
}

/**
 * Execute a natural language query
 *
 * Forwards request to AI container, which returns a structured query.
 * Backend then executes the query against the database.
 */
export async function executeNaturalQuery(
  query: string,
  walletId: string,
  authToken: string
): Promise<QueryResult | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Sync config to container
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ query, walletId }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      log.error('AI query failed', { status: response.status, error: error?.error });
      return null;
    }

    const json = await response.json();
    const result = validateResponse<AIQueryResponse>(json, ['query']);

    if (!result) {
      log.error('Invalid response from AI container for query');
      return null;
    }

    return result.query || null;
  } catch (error) {
    log.error('AI query error', { error: String(error) });
    return null;
  }
}

/**
 * Detect Ollama at common endpoints
 */
export async function detectOllama(): Promise<{
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}/detect-ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { found: false, message: 'Detection failed' };
    }

    const json = await response.json();
    const result = validateResponse<AIDetectOllamaResponse>(json, ['found']);

    if (!result) {
      log.error('Invalid response from AI container for Ollama detection');
      return { found: false, message: 'Invalid response format' };
    }

    return result;
  } catch (error) {
    log.error('Ollama detection error', { error: String(error) });
    return { found: false, message: 'AI container not available' };
  }
}

/**
 * List available models from configured endpoint
 */
export async function listModels(): Promise<{
  models: Array<{ name: string; size: number; modifiedAt: string }>;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.endpoint) {
    return { models: [], error: 'No AI endpoint configured' };
  }

  // Sync config first so container knows the endpoint
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/list-models`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      return { models: [], error: error?.error || 'Failed to list models' };
    }

    const json = await response.json();
    const result = validateResponse<AIListModelsResponse>(json, ['models']);

    if (!result) {
      log.error('Invalid response from AI container for list models');
      return { models: [], error: 'Invalid response format' };
    }

    return result;
  } catch (error) {
    log.error('List models error', { error: String(error) });
    return { models: [], error: 'Cannot connect to AI container' };
  }
}

/**
 * Pull (download) a model
 */
export async function pullModel(model: string): Promise<{
  success: boolean;
  model?: string;
  status?: string;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.endpoint) {
    return { success: false, error: 'No AI endpoint configured' };
  }

  // Sync config first
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/pull-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(600000), // 10 minute timeout for large models
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      return { success: false, error: error?.error || 'Pull failed' };
    }

    const json = await response.json();
    const result = validateResponse<AIPullModelResponse>(json, ['success']);

    if (!result) {
      log.error('Invalid response from AI container for pull model');
      return { success: false, error: 'Invalid response format' };
    }

    return result;
  } catch (error) {
    log.error('Pull model error', { error: String(error) });
    return { success: false, error: 'Pull operation failed' };
  }
}

/**
 * AI Service - exported for use in API routes
 */
export const aiService = {
  isEnabled,
  isContainerAvailable,
  checkHealth,
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  listModels,
  pullModel,
  forceSyncConfig,
};
