/**
 * Wallet Validation Schemas
 *
 * Zod schemas for wallet endpoints.
 */

import { z } from 'zod';
import {
  UuidSchema,
  NetworkTypeSchema,
  ScriptTypeSchema,
  WalletTypeSchema,
  XpubSchema,
  DerivationPathSchema,
  FingerprintSchema,
  BitcoinAddressSchema,
  SatoshiAmountSchema,
  FeeRateSchema,
  PsbtSchema,
  TxidSchema,
  PaginationSchema,
} from './common';

// =============================================================================
// Wallet Creation
// =============================================================================

/** Single-sig wallet creation */
export const CreateWalletSchema = z.object({
  name: z.string().min(1, 'Wallet name is required').max(100),
  network: NetworkTypeSchema,
  scriptType: ScriptTypeSchema,
  type: WalletTypeSchema.default('standard'),
  xpub: XpubSchema.optional(),
  derivationPath: DerivationPathSchema.optional(),
  fingerprint: FingerprintSchema.optional(),
  deviceId: UuidSchema.optional(),
});

/** Multisig wallet signer */
export const MultisigSignerSchema = z.object({
  xpub: XpubSchema,
  derivationPath: DerivationPathSchema.optional(),
  fingerprint: FingerprintSchema.optional(),
  deviceId: UuidSchema.optional(),
  label: z.string().optional(),
});

/** Multisig wallet creation */
export const CreateMultisigWalletSchema = z.object({
  name: z.string().min(1, 'Wallet name is required').max(100),
  network: NetworkTypeSchema,
  scriptType: ScriptTypeSchema,
  type: z.literal('multisig'),
  requiredSignatures: z.number().int().min(1).max(15),
  totalSigners: z.number().int().min(2).max(15),
  signers: z.array(MultisigSignerSchema).min(2).max(15),
}).refine(
  (data) => data.requiredSignatures <= data.totalSigners,
  { message: 'Required signatures cannot exceed total signers' }
).refine(
  (data) => data.signers.length === data.totalSigners,
  { message: 'Number of signers must match totalSigners' }
);

// =============================================================================
// Wallet Update
// =============================================================================

export const UpdateWalletSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

// =============================================================================
// Wallet Sharing
// =============================================================================

export const ShareWalletSchema = z.object({
  targetUserId: UuidSchema,
  role: z.enum(['viewer', 'signer']).default('viewer'),
});

export const UnshareWalletSchema = z.object({
  targetUserId: UuidSchema,
});

// =============================================================================
// Address Generation
// =============================================================================

export const GenerateAddressSchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(1),
  change: z.coerce.boolean().default(false),
});

// =============================================================================
// Transaction Creation
// =============================================================================

export const TransactionOutputSchema = z.object({
  address: BitcoinAddressSchema,
  amount: SatoshiAmountSchema,
});

export const CreateTransactionSchema = z.object({
  outputs: z.array(TransactionOutputSchema).min(1, 'At least one output is required'),
  feeRate: FeeRateSchema.optional(),
  rbf: z.boolean().optional().default(true),
  subtractFeeFromOutputs: z.array(z.number().int().min(0)).optional(),
  utxos: z.array(z.string()).optional(), // Manual UTXO selection
  changeAddress: BitcoinAddressSchema.optional(),
});

export const SignTransactionSchema = z.object({
  psbt: PsbtSchema,
  signedPsbt: PsbtSchema.optional(), // For partial signatures
});

export const BroadcastTransactionSchema = z.object({
  psbt: PsbtSchema.optional(),
  rawTx: z.string().optional(),
}).refine(
  (data) => data.psbt || data.rawTx,
  { message: 'Either psbt or rawTx is required' }
);

// =============================================================================
// RBF (Replace-By-Fee)
// =============================================================================

export const RbfTransactionSchema = z.object({
  txid: TxidSchema,
  newFeeRate: FeeRateSchema,
});

// =============================================================================
// CPFP (Child-Pays-For-Parent)
// =============================================================================

export const CpfpTransactionSchema = z.object({
  txid: TxidSchema,
  targetFeeRate: FeeRateSchema,
});

// =============================================================================
// Transaction Filters
// =============================================================================

export const TransactionFilterSchema = PaginationSchema.extend({
  type: z.enum(['all', 'sent', 'received']).optional(),
  confirmed: z.coerce.boolean().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  minAmount: SatoshiAmountSchema.optional(),
  maxAmount: SatoshiAmountSchema.optional(),
});

// =============================================================================
// UTXO Selection
// =============================================================================

export const UtxoSelectionSchema = z.object({
  utxos: z.array(z.object({
    txid: TxidSchema,
    vout: z.number().int().min(0),
  })).min(1),
});

// =============================================================================
// Wallet Import
// =============================================================================

export const ImportWalletDescriptorSchema = z.object({
  name: z.string().min(1).max(100),
  descriptor: z.string().min(1, 'Descriptor is required'),
  network: NetworkTypeSchema.optional(),
});

export const ImportWalletXpubSchema = z.object({
  name: z.string().min(1).max(100),
  xpub: XpubSchema,
  network: NetworkTypeSchema,
  scriptType: ScriptTypeSchema,
  derivationPath: DerivationPathSchema.optional(),
  fingerprint: FingerprintSchema.optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type CreateWalletInput = z.infer<typeof CreateWalletSchema>;
export type CreateMultisigWalletInput = z.infer<typeof CreateMultisigWalletSchema>;
export type UpdateWalletInput = z.infer<typeof UpdateWalletSchema>;
export type ShareWalletInput = z.infer<typeof ShareWalletSchema>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type TransactionFilter = z.infer<typeof TransactionFilterSchema>;
