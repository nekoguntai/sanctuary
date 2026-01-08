/**
 * Beacon Client for Sanctuary
 *
 * This client integrates with the Beacon Lightning service from Sanctuary.
 * It provides methods for Lightning payments, invoices, and swaps.
 *
 * Usage:
 *   const beacon = new BeaconClient({
 *     baseUrl: process.env.BEACON_URL,
 *     apiKey: process.env.BEACON_API_KEY,
 *   });
 *
 *   // Pay a Lightning invoice via submarine swap
 *   const swap = await beacon.payFromCold({
 *     invoice: 'lnbc...',
 *     refundAddress: 'bc1q...',
 *     userId: user.id,
 *   });
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../../utils/logger';

const log = createLogger('beacon-client');

// =============================================================================
// Types
// =============================================================================

export interface BeaconClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Submarine swap status values:
 * - 'created'     - Swap created, waiting for on-chain deposit
 * - 'pending'     - On-chain transaction detected, waiting for confirmations
 * - 'confirmed'   - On-chain transaction confirmed, Lightning payment in progress
 * - 'completed'   - Lightning payment successful, swap finished
 * - 'expired'     - Swap expired before completion (refund available)
 * - 'refunded'    - On-chain funds returned to refund address
 * - 'failed'      - Swap failed (e.g., Lightning payment failed after on-chain confirm)
 */
export type BeaconSwapStatus =
  | 'created'
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'expired'
  | 'refunded'
  | 'failed';

export interface BeaconSwap {
  id: string;
  type: 'normal' | 'reverse';
  status: BeaconSwapStatus;
  createdAt: number;
  expiresAt: number;
  onchain?: {
    address: string;
    expectedAmountSats: string;
    actualAmountSats?: string;
    txid?: string;
    confirmations?: number;
  };
  lightning: {
    invoice: string;
    amountSats: string;
    paymentHash: string;
  };
  fees: {
    serviceFeePercent: number;
    serviceFeeSats: string;
    networkFeeSats: string;
  };
  refund?: {
    address: string;
    txid?: string;
  };
}

/**
 * Invoice status values:
 * - 'pending'  - Invoice created, awaiting payment
 * - 'settled'  - Payment received and settled
 * - 'expired'  - Invoice expired without payment
 */
export type BeaconInvoiceStatus = 'pending' | 'settled' | 'expired';

export interface BeaconInvoice {
  paymentHash: string;
  paymentRequest: string;
  amountMsat: string | null;
  description: string;
  expiresAt: number;
  status: BeaconInvoiceStatus;
  settledAt?: number;
}

/**
 * Payment status values:
 * - 'pending'   - Payment initiated, in progress
 * - 'succeeded' - Payment completed successfully
 * - 'failed'    - Payment failed (see failureReason for details)
 */
export type BeaconPaymentStatus = 'pending' | 'succeeded' | 'failed';

export interface BeaconPayment {
  paymentHash: string;
  paymentPreimage?: string;
  amountMsat: string;
  feeMsat: string;
  status: BeaconPaymentStatus;
  createdAt: number;
  settledAt?: number;
  failureReason?: string;
}

export interface BeaconBalance {
  totalSats: string;
  spendableSats: string;
  receivableSats: string;
  pendingSats: string;
  swapPendingSats: string;
}

export interface BeaconInfo {
  features: {
    swaps: boolean;
    federation: boolean;
    lightning: boolean;
    taprootAssets: boolean;
  };
  version: string;
}

interface ApiResponse<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

type ApiResult<T> = ApiResponse<T> | ApiError;

// =============================================================================
// Beacon Client
// =============================================================================

export class BeaconClient {
  private readonly client: AxiosInstance;

  constructor(config: BeaconClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiError>) => {
        if (error.response?.data?.error) {
          const apiError = error.response.data.error;
          log.error('Beacon API error', {
            code: apiError.code,
            message: apiError.message,
            path: error.config?.url,
            method: error.config?.method?.toUpperCase(),
          });
          throw new BeaconApiError(apiError.code, apiError.message);
        }
        throw error;
      }
    );
  }

  // ===========================================================================
  // Info & Health
  // ===========================================================================

  /**
   * Check if Beacon service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/health');
      return response.data?.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Get Beacon service info and available features
   */
  async getInfo(): Promise<BeaconInfo> {
    const response = await this.client.get<ApiResult<BeaconInfo>>('/api/info');
    return this.unwrap(response.data);
  }

  // ===========================================================================
  // Submarine Swaps (Phase 1)
  // ===========================================================================

  /**
   * Create a submarine swap to pay a Lightning invoice from on-chain funds.
   *
   * Returns an on-chain address. When user sends BTC to this address,
   * Beacon will pay the Lightning invoice.
   *
   * @param params.type - 'normal' for on-chain→Lightning, 'reverse' for Lightning→on-chain
   * @param params.invoice - Lightning invoice to pay (required for normal swaps)
   * @param params.amountSats - Amount in satoshis (required for reverse swaps)
   * @param params.refundAddress - Bitcoin address for refunds if swap fails/expires.
   *   Must be a valid address for the configured network (mainnet/testnet/signet).
   *   Supported formats: P2WPKH (bc1q...), P2WSH (bc1q...), P2TR (bc1p...), P2PKH (1...), P2SH (3...)
   *
   * @returns BeaconSwap with on-chain deposit address and swap details
   *
   * @example
   * // Pay a Lightning invoice from cold storage
   * const swap = await beacon.createSwap({
   *   type: 'normal',
   *   invoice: 'lnbc1000n1...',
   *   refundAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
   * });
   * // Send BTC to swap.onchain.address, then monitor swap.status
   */
  async createSwap(params: {
    type: 'normal' | 'reverse';
    invoice?: string;
    amountSats?: string;
    refundAddress: string;
  }): Promise<BeaconSwap> {
    const response = await this.client.post<ApiResult<BeaconSwap>>(
      '/api/swaps',
      params
    );
    return this.unwrap(response.data);
  }

  /**
   * Pay a Lightning invoice from cold storage via submarine swap.
   *
   * This is a convenience method that creates a normal swap.
   */
  async payFromCold(params: {
    invoice: string;
    refundAddress: string;
  }): Promise<BeaconSwap> {
    return this.createSwap({
      type: 'normal',
      invoice: params.invoice,
      refundAddress: params.refundAddress,
    });
  }

  /**
   * Get swap by ID
   */
  async getSwap(swapId: string): Promise<BeaconSwap> {
    const response = await this.client.get<ApiResult<BeaconSwap>>(
      `/api/swaps/${swapId}`
    );
    return this.unwrap(response.data);
  }

  /**
   * List swaps for current user
   */
  async listSwaps(): Promise<BeaconSwap[]> {
    const response = await this.client.get<ApiResult<BeaconSwap[]>>('/api/swaps');
    return this.unwrap(response.data);
  }

  /**
   * Refresh swap status from Boltz
   */
  async refreshSwap(swapId: string): Promise<BeaconSwap> {
    const response = await this.client.post<ApiResult<BeaconSwap>>(
      `/api/swaps/${swapId}/refresh`
    );
    return this.unwrap(response.data);
  }

  // ===========================================================================
  // Invoices (Phase 3)
  // ===========================================================================

  /**
   * Create a Lightning invoice for receiving payments
   */
  async createInvoice(params: {
    amountMsat?: string;
    description: string;
    expirySecs?: number;
  }): Promise<BeaconInvoice> {
    const response = await this.client.post<ApiResult<BeaconInvoice>>(
      '/api/invoices',
      params
    );
    return this.unwrap(response.data);
  }

  /**
   * Get invoice by payment hash
   */
  async getInvoice(paymentHash: string): Promise<BeaconInvoice> {
    const response = await this.client.get<ApiResult<BeaconInvoice>>(
      `/api/invoices/${paymentHash}`
    );
    return this.unwrap(response.data);
  }

  /**
   * List invoices
   */
  async listInvoices(params?: {
    status?: 'pending' | 'settled' | 'expired';
    limit?: number;
    offset?: number;
  }): Promise<BeaconInvoice[]> {
    const response = await this.client.get<ApiResult<BeaconInvoice[]>>(
      '/api/invoices',
      { params }
    );
    return this.unwrap(response.data);
  }

  // ===========================================================================
  // Payments (Phase 3)
  // ===========================================================================

  /**
   * Pay a Lightning invoice directly (requires Lightning to be enabled)
   */
  async payInvoice(params: {
    invoice: string;
    amountMsat?: string;
    maxFeeMsat?: string;
    timeoutSecs?: number;
  }): Promise<BeaconPayment> {
    const response = await this.client.post<ApiResult<BeaconPayment>>(
      '/api/payments',
      params
    );
    return this.unwrap(response.data);
  }

  /**
   * Get payment by hash
   */
  async getPayment(paymentHash: string): Promise<BeaconPayment> {
    const response = await this.client.get<ApiResult<BeaconPayment>>(
      `/api/payments/${paymentHash}`
    );
    return this.unwrap(response.data);
  }

  /**
   * List payments
   */
  async listPayments(params?: {
    status?: 'pending' | 'succeeded' | 'failed';
    limit?: number;
    offset?: number;
  }): Promise<BeaconPayment[]> {
    const response = await this.client.get<ApiResult<BeaconPayment[]>>(
      '/api/payments',
      { params }
    );
    return this.unwrap(response.data);
  }

  // ===========================================================================
  // Balance (Phase 3)
  // ===========================================================================

  /**
   * Get Lightning balance
   */
  async getBalance(): Promise<BeaconBalance> {
    const response = await this.client.get<ApiResult<BeaconBalance>>(
      '/api/balance'
    );
    return this.unwrap(response.data);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private unwrap<T>(result: ApiResult<T>): T {
    if (!result.success) {
      throw new BeaconApiError(result.error.code, result.error.message);
    }
    return result.data;
  }
}

// =============================================================================
// Errors
// =============================================================================

export class BeaconApiError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'BeaconApiError';
  }
}

// =============================================================================
// Factory
// =============================================================================

let beaconClientInstance: BeaconClient | null = null;

/**
 * Get or create the Beacon client singleton
 */
export function getBeaconClient(): BeaconClient | null {
  if (beaconClientInstance) {
    return beaconClientInstance;
  }

  const baseUrl = process.env.BEACON_URL;
  const apiKey = process.env.BEACON_API_KEY;

  if (!baseUrl || !apiKey) {
    log.debug('Beacon not configured (BEACON_URL or BEACON_API_KEY missing)');
    return null;
  }

  beaconClientInstance = new BeaconClient({ baseUrl, apiKey });
  return beaconClientInstance;
}

/**
 * Check if Beacon integration is available
 */
export function isBeaconEnabled(): boolean {
  return !!process.env.BEACON_URL && !!process.env.BEACON_API_KEY;
}

/**
 * Reset the Beacon client singleton.
 * Useful for testing or when credentials change at runtime.
 */
export function resetBeaconClient(): void {
  beaconClientInstance = null;
}
