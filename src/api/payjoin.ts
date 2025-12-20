/**
 * Payjoin API Client
 *
 * Frontend API calls for BIP78 Payjoin functionality
 */

import apiClient from './client';

export interface PayjoinUriResponse {
  uri: string;
  address: string;
  payjoinUrl: string;
}

export interface ParsedUri {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
  payjoinUrl?: string;
  hasPayjoin: boolean;
}

export interface PayjoinAttemptResult {
  success: boolean;
  proposalPsbt?: string;
  isPayjoin: boolean;
  error?: string;
}

/**
 * Generate a BIP21 URI with Payjoin endpoint for an address
 */
export async function getPayjoinUri(
  addressId: string,
  options?: {
    amount?: number;
    label?: string;
    message?: string;
  }
): Promise<PayjoinUriResponse> {
  const params: Record<string, string> = {};
  if (options?.amount) params.amount = String(options.amount);
  if (options?.label) params.label = options.label;
  if (options?.message) params.message = options.message;

  return apiClient.get<PayjoinUriResponse>(`/payjoin/address/${addressId}/uri`, params);
}

/**
 * Parse a BIP21 URI to extract address and Payjoin URL
 */
export async function parsePayjoinUri(uri: string): Promise<ParsedUri> {
  return apiClient.post<ParsedUri>('/payjoin/parse-uri', { uri });
}

/**
 * Attempt to perform a Payjoin send
 * Returns the Payjoin proposal PSBT if successful
 */
export async function attemptPayjoin(
  psbt: string,
  payjoinUrl: string
): Promise<PayjoinAttemptResult> {
  return apiClient.post<PayjoinAttemptResult>('/payjoin/attempt', {
    psbt,
    payjoinUrl,
  });
}
