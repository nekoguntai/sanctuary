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
  containerAvailable?: boolean;
}

export interface SuggestLabelRequest {
  transactionId: string;
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

// ========================================
// MODEL MANAGEMENT
// ========================================

export interface DetectOllamaResponse {
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ListModelsResponse {
  models: OllamaModel[];
  error?: string;
}

export interface PullModelResponse {
  success: boolean;
  model?: string;
  status?: string;
  error?: string;
}

/**
 * Auto-detect Ollama at common endpoints
 */
export async function detectOllama(): Promise<DetectOllamaResponse> {
  return apiClient.post<DetectOllamaResponse>('/ai/detect-ollama', {});
}

/**
 * List available models from configured endpoint
 */
export async function listModels(): Promise<ListModelsResponse> {
  return apiClient.get<ListModelsResponse>('/ai/models');
}

/**
 * Pull (download) a model from Ollama
 */
export async function pullModel(model: string): Promise<PullModelResponse> {
  return apiClient.post<PullModelResponse>('/ai/pull-model', { model });
}
