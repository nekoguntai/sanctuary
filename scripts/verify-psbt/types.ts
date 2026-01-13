/**
 * PSBT Verification Types
 *
 * Type definitions for cross-implementation PSBT verification.
 * Used for testing that our PSBT generation matches Bitcoin Core and other implementations.
 */

export type Network = 'mainnet' | 'testnet' | 'regtest';

export type WalletType = 'single_sig' | 'multi_sig';

export type SingleSigScriptType = 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr';

export type MultisigScriptType = 'p2wsh' | 'p2sh-p2wsh' | 'p2sh';

export type ScriptType = SingleSigScriptType | MultisigScriptType;

export interface PsbtInput {
  txid: string;
  vout: number;
  amount: number;
  scriptPubKey: string;
  derivationPath: string;
  witnessUtxo?: {
    script: string;
    value: number;
  };
  nonWitnessUtxo?: string; // Full previous tx hex for legacy inputs
  redeemScript?: string; // For P2SH-P2WPKH and P2SH-P2WSH
  witnessScript?: string; // For P2WSH and P2SH-P2WSH
}

export interface PsbtOutput {
  address: string;
  amount: number;
  isChange: boolean;
  derivationPath?: string;
}

export interface VerifiedPsbtVector {
  // Identity
  id: string;
  description: string;

  // Wallet configuration
  walletType: WalletType;
  scriptType: ScriptType;
  network: Network;

  // Multisig-specific
  quorum?: number;
  totalSigners?: number;
  xpubs?: string[];

  // Transaction details
  inputs: PsbtInput[];
  outputs: PsbtOutput[];

  // Expected results
  expectedPsbtBase64: string;
  expectedTxid: string;
  expectedVsize: number;
  expectedFee: number;

  // Provenance
  verifiedBy: string[];
  generatedAt: string;

  // For signed vectors
  signatures?: Array<{
    inputIndex: number;
    pubkey: string;
    signature: string;
    sighashType: number;
  }>;

  expectedSignedPsbtBase64?: string;
  expectedFinalTxHex?: string;
}

/**
 * BIP-174 Official Test Vector
 *
 * These are the official test vectors from the BIP-174 specification.
 * Each vector tests a specific role in the PSBT workflow:
 * - Creator: Creates the unsigned transaction
 * - Updater: Adds UTXO data, scripts, bip32 derivations
 * - Signer: Adds partial signatures
 * - Combiner: Merges multiple PSBTs
 * - Finalizer: Creates the final scriptSig/scriptWitness
 * - Extractor: Extracts the final signed transaction
 */
export interface Bip174TestVector {
  description: string;
  role: 'creator' | 'updater' | 'signer' | 'combiner' | 'finalizer' | 'extractor';
  inputPsbtBase64?: string;
  expectedOutputBase64: string;
  expectedTxHex?: string; // Only for extractor role
  comment?: string;
}

/**
 * PSBT Validation Result
 */
export interface PsbtValidationResult {
  valid: boolean;
  error?: string;
  decoded?: {
    txid: string;
    inputs: number;
    outputs: number;
    fee: number;
    vsize: number;
    complete: boolean;
  };
}

/**
 * Implementation interface for cross-verification
 */
export interface PsbtImplementation {
  name: string;
  version: string;

  /**
   * Create an unsigned PSBT from inputs and outputs
   */
  createPsbt(params: {
    inputs: PsbtInput[];
    outputs: PsbtOutput[];
    network: Network;
  }): Promise<string>;

  /**
   * Validate a PSBT and return decoded information
   */
  validatePsbt(psbtBase64: string): Promise<PsbtValidationResult>;

  /**
   * Decode a PSBT and return its structure
   */
  decodePsbt(psbtBase64: string): Promise<Record<string, unknown>>;

  /**
   * Finalize a fully-signed PSBT and return the raw transaction hex
   */
  finalizePsbt(psbtBase64: string): Promise<string>;
}
