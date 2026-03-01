/**
 * PSBT Builder Types
 *
 * Shared types used across PSBT builder submodules.
 */

/**
 * BIP32 derivation entry for PSBT inputs/outputs
 */
export interface Bip32DerivationEntry {
  masterFingerprint: Buffer;
  path: string;
  pubkey: Buffer;
}
