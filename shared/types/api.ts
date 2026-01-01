/**
 * Shared API Contract Types
 *
 * These types define the contract between frontend and backend.
 * Both sides must use these types to ensure compatibility.
 *
 * ## Usage
 *
 * Backend: Use these types in API route responses
 * ```typescript
 * import { WalletResponse } from '@sanctuary/shared/types/api';
 * res.json(wallet as WalletResponse);
 * ```
 *
 * Frontend: Use these types in API clients
 * ```typescript
 * import { WalletResponse } from '@sanctuary/shared/types/api';
 * const wallet = await apiClient.get<WalletResponse>('/wallets/123');
 * ```
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Standard API error response
 */
export interface ApiErrorResponse {
  error: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Success response with message
 */
export interface SuccessResponse {
  success: boolean;
  message: string;
}

// =============================================================================
// Wallet API Contracts
// =============================================================================

/**
 * Wallet type enum value
 */
export type ApiWalletType = 'single_sig' | 'multi_sig';

/**
 * Script type enum value
 */
export type ApiScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';

/**
 * Network enum value
 */
export type ApiNetwork = 'mainnet' | 'testnet' | 'regtest' | 'signet';

/**
 * Wallet role enum value
 */
export type ApiWalletRole = 'owner' | 'signer' | 'viewer';

/**
 * Sync status enum value
 */
export type ApiSyncStatus = 'synced' | 'syncing' | 'error' | 'pending' | 'never';

/**
 * GET /wallets/:id response
 * GET /wallets (array of these)
 */
export interface WalletResponse {
  id: string;
  name: string;
  type: ApiWalletType;
  scriptType: ApiScriptType;
  network: ApiNetwork;
  quorum: number | null;
  totalSigners: number | null;
  descriptor: string | null;
  balance: string; // bigint as string
  unconfirmedBalance: string; // bigint as string
  lastSynced: string | null; // ISO date string
  syncStatus: ApiSyncStatus;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  role: ApiWalletRole;
  deviceCount: number;
  isShared: boolean;
  pendingConsolidation: boolean;
  pendingReceive: boolean;
  pendingSend: boolean;
  hasPendingDraft: boolean;
  group: {
    id: string;
    name: string;
  } | null;
}

/**
 * POST /wallets request
 */
export interface CreateWalletRequest {
  name: string;
  type: ApiWalletType;
  scriptType: ApiScriptType;
  network?: ApiNetwork;
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  groupId?: string;
  deviceIds?: string[];
}

/**
 * PATCH /wallets/:id request
 */
export interface UpdateWalletRequest {
  name?: string;
  descriptor?: string;
}

/**
 * GET /wallets/:id/stats response
 */
export interface WalletStatsResponse {
  balance: number;
  received: number;
  sent: number;
  transactionCount: number;
  utxoCount: number;
  addressCount: number;
}

// =============================================================================
// Device API Contracts
// =============================================================================

/**
 * Device role enum value
 */
export type ApiDeviceRole = 'owner' | 'viewer';

/**
 * GET /devices/:id response
 * GET /devices (array of these)
 */
export interface DeviceResponse {
  id: string;
  label: string;
  fingerprint: string;
  xpub: string | null;
  derivationPath: string | null;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  role: ApiDeviceRole;
  walletCount: number;
  model: string | null;
  type: string | null;
}

/**
 * POST /devices request
 */
export interface CreateDeviceRequest {
  label: string;
  fingerprint: string;
  xpub?: string;
  derivationPath?: string;
  model?: string;
  type?: string;
}

/**
 * PATCH /devices/:id request
 */
export interface UpdateDeviceRequest {
  label?: string;
  xpub?: string;
  derivationPath?: string;
}

// =============================================================================
// Transaction API Contracts
// =============================================================================

/**
 * Transaction type enum value
 */
export type ApiTransactionType = 'sent' | 'received' | 'self' | 'consolidation';

/**
 * Transaction status enum value
 */
export type ApiTransactionStatus = 'confirmed' | 'pending' | 'replaced';

/**
 * GET /wallets/:id/transactions (array of these)
 */
export interface TransactionResponse {
  id: string;
  txid: string;
  type: ApiTransactionType;
  status: ApiTransactionStatus;
  amount: string; // bigint as string
  fee: string; // bigint as string
  confirmations: number;
  blockHeight: number | null;
  blockTime: string | null; // ISO date string
  createdAt: string; // ISO date string
  label: string | null;
  memo: string | null;
  isRbf: boolean;
  replacedByTxid: string | null;
}

// =============================================================================
// Auth API Contracts
// =============================================================================

/**
 * POST /auth/login request
 */
export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * POST /auth/login response
 */
export interface LoginResponse {
  token: string;
  refreshToken: string;
  user: UserResponse;
  requires2FA?: boolean;
}

/**
 * POST /auth/register request
 */
export interface RegisterRequest {
  username: string;
  password: string;
}

/**
 * POST /auth/register response
 */
export interface RegisterResponse {
  token: string;
  refreshToken: string;
  user: UserResponse;
}

/**
 * User response (embedded in auth responses)
 */
export interface UserResponse {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string; // ISO date string
  preferences: Record<string, unknown> | null;
  has2FA: boolean;
}

// =============================================================================
// Sync API Contracts
// =============================================================================

/**
 * POST /sync/wallet/:id response
 */
export interface SyncWalletResponse {
  success: boolean;
  walletId: string;
  balance: string; // bigint as string
  unconfirmedBalance: string; // bigint as string
  transactionsFound: number;
  newAddressesGenerated: number;
  duration: number;
}

// =============================================================================
// Price API Contracts
// =============================================================================

/**
 * GET /price response
 */
export interface PriceResponse {
  price: number;
  currency: string;
  change24h: number;
  updatedAt: string; // ISO date string
}

// =============================================================================
// Bitcoin API Contracts
// =============================================================================

/**
 * GET /bitcoin/fees response
 */
export interface FeeEstimatesResponse {
  fastest: number;
  fast: number;
  medium: number;
  slow: number;
  minimum: number;
  updatedAt: string; // ISO date string
}

/**
 * POST /bitcoin/broadcast request
 */
export interface BroadcastRequest {
  hex: string;
  walletId: string;
}

/**
 * POST /bitcoin/broadcast response
 */
export interface BroadcastResponse {
  success: boolean;
  txid: string;
}

// =============================================================================
// Draft API Contracts
// =============================================================================

/**
 * Draft status enum value
 */
export type ApiDraftStatus = 'pending' | 'signed' | 'broadcast' | 'expired' | 'cancelled';

/**
 * GET /drafts/:id response
 */
export interface DraftResponse {
  id: string;
  walletId: string;
  status: ApiDraftStatus;
  psbt: string;
  amount: string; // bigint as string
  fee: string; // bigint as string
  recipients: Array<{
    address: string;
    amount: string; // bigint as string
  }>;
  signers: Array<{
    fingerprint: string;
    signed: boolean;
    signedAt: string | null;
  }>;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  expiresAt: string | null; // ISO date string
  memo: string | null;
}

/**
 * POST /drafts request
 */
export interface CreateDraftRequest {
  walletId: string;
  psbt: string;
  memo?: string;
}

// =============================================================================
// Admin API Contracts
// =============================================================================

/**
 * GET /admin/users (array of these)
 */
export interface AdminUserResponse {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  walletCount: number;
  deviceCount: number;
}

/**
 * GET /admin/stats response
 */
export interface AdminStatsResponse {
  totalUsers: number;
  totalWallets: number;
  totalDevices: number;
  totalTransactions: number;
  activeUsers24h: number;
}
