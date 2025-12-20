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

const log = createLogger('AI');

// AI container URL
const AI_CONTAINER_URL = process.env.AI_CONTAINER_URL || 'http://ai:3100';

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
 */
async function syncConfigToContainer(config: AIConfig): Promise<boolean> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: config.enabled,
        endpoint: config.endpoint,
        model: config.model,
      }),
      signal: AbortSignal.timeout(5000),
    });

    return response.ok;
  } catch (error) {
    log.error('Failed to sync config to AI container', { error: String(error) });
    return false;
  }
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

    const result = await response.json() as any;

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
      const error = await response.json().catch(() => ({})) as any;
      log.error('AI label suggestion failed', { status: response.status, error: error.error });
      return null;
    }

    const result = await response.json() as any;
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
      const error = await response.json().catch(() => ({})) as any;
      log.error('AI query failed', { status: response.status, error: error.error });
      return null;
    }

    const result = await response.json() as any;
    return result.query || null;
  } catch (error) {
    log.error('AI query error', { error: String(error) });
    return null;
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
};
