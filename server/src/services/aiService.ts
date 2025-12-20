/**
 * AI Service
 *
 * Provides AI-powered features for transaction labeling and natural language queries.
 * Uses OpenAI-compatible API standard, allowing any inference backend (Ollama, llama.cpp, etc.).
 *
 * IMPORTANT: This service is read-only and never modifies wallet data.
 * AI capabilities are optional and disabled by default.
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const log = createLogger('AI');

/**
 * Transaction context for label suggestions
 */
export interface TransactionContext {
  amount: number; // Amount in satoshis
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
 * OpenAI-compatible API request
 */
interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
}

/**
 * OpenAI-compatible API response
 */
interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
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
 * Check if AI is enabled in settings
 */
export async function isEnabled(): Promise<boolean> {
  const config = await getAIConfig();
  return config.enabled && !!config.endpoint && !!config.model;
}

/**
 * Call the AI endpoint with a prompt
 */
async function callAI(prompt: string, config: AIConfig, timeout = 30000): Promise<string | null> {
  try {
    // Ensure endpoint is properly formatted
    let endpoint = config.endpoint.trim();
    if (!endpoint.endsWith('/')) {
      endpoint += '/';
    }
    if (!endpoint.includes('/v1/chat/completions')) {
      // Remove trailing slash and add the path
      endpoint = endpoint.replace(/\/$/, '') + '/v1/chat/completions';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      } as ChatCompletionRequest),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      log.error('AI API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return null;
    }

    const data = (await response.json()) as ChatCompletionResponse;

    if (!data.choices || data.choices.length === 0) {
      log.error('AI API returned no choices');
      return null;
    }

    const content = data.choices[0].message.content.trim();
    return content;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      log.error('AI request timeout');
    } else {
      log.error('AI request failed', { error: String(error) });
    }
    return null;
  }
}

/**
 * Check AI endpoint health
 */
export async function checkHealth(): Promise<{
  available: boolean;
  model?: string;
  endpoint?: string;
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

  // Try a simple health check prompt
  const result = await callAI('Say "OK"', config, 10000);

  return {
    available: result !== null,
    model: config.model,
    endpoint: config.endpoint,
    error: result === null ? 'AI endpoint is not reachable' : undefined,
  };
}

/**
 * Suggest a transaction label based on transaction context
 */
export async function suggestTransactionLabel(
  context: TransactionContext
): Promise<string | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Build prompt
  const existingLabelsStr = context.existingLabels && context.existingLabels.length > 0
    ? context.existingLabels.join(', ')
    : 'None';

  const prompt = `You are a Bitcoin transaction categorizer. Based on the transaction details, suggest a short label (1-4 words).

Transaction:
- Amount: ${context.amount} sats (${context.direction})
- Address: ${context.address || 'Unknown'}
- Date: ${context.date.toISOString()}
- Existing labels in wallet: ${existingLabelsStr}

Respond with ONLY the suggested label, nothing else.
Examples: "Exchange Deposit", "Hardware Purchase", "Salary", "Gift"`;

  const result = await callAI(prompt, config);

  if (!result) {
    return null;
  }

  // Clean up the result - remove quotes and limit length
  let label = result.replace(/^["']|["']$/g, '').trim();

  // Limit to 50 characters
  if (label.length > 50) {
    label = label.substring(0, 50);
  }

  return label;
}

/**
 * Execute a natural language query
 */
export async function executeNaturalQuery(
  query: string,
  walletId: string
): Promise<QueryResult | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Get some context about the wallet for better suggestions
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      labels: {
        take: 20,
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  const recentLabels = wallet?.labels.map((l) => l.name).join(', ') || 'None';

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

  const result = await callAI(prompt, config);

  if (!result) {
    return null;
  }

  try {
    // Extract JSON from the response (in case AI added extra text)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.error('AI did not return valid JSON');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as QueryResult;
    return parsed;
  } catch (error) {
    log.error('Failed to parse AI query result', { error: String(error), result });
    return null;
  }
}

/**
 * AI Service - exported for use in API routes
 */
export const aiService = {
  isEnabled,
  checkHealth,
  suggestTransactionLabel,
  executeNaturalQuery,
};
