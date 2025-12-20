/**
 * AI API
 *
 * API calls for AI-powered features (transaction labeling, natural language queries)
 */

import apiClient from './client';

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface AIStatus {
  available: boolean;
  model?: string;
  endpoint?: string;
  error?: string;
  message?: string;
}

export interface SuggestLabelRequest {
  amount: number; // satoshis
  direction: 'send' | 'receive';
  address?: string;
  date: string; // ISO date
  existingLabels?: string[];
}

export interface SuggestLabelResponse {
  suggestion: string;
}

export interface NaturalQueryRequest {
  query: string;
  walletId: string;
}

export interface NaturalQueryResult {
  type: 'transactions' | 'addresses' | 'utxos' | 'summary';
  filter?: Record<string, any>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  limit?: number;
  aggregation?: 'sum' | 'count' | 'max' | 'min' | null;
}

// ========================================
// API FUNCTIONS
// ========================================

/**
 * Check AI availability and status
 */
export async function getAIStatus(): Promise<AIStatus> {
  return apiClient.get<AIStatus>('/ai/status');
}

/**
 * Get a label suggestion for a transaction
 */
export async function suggestLabel(request: SuggestLabelRequest): Promise<SuggestLabelResponse> {
  return apiClient.post<SuggestLabelResponse>('/ai/suggest-label', request);
}

/**
 * Execute a natural language query
 */
export async function executeNaturalQuery(request: NaturalQueryRequest): Promise<NaturalQueryResult> {
  return apiClient.post<NaturalQueryResult>('/ai/query', request);
}
