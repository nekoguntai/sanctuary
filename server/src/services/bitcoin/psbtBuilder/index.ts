/**
 * PSBT Builder Module
 *
 * Utilities for building PSBT inputs and outputs, including:
 * - BIP32 derivation entries for hardware wallet signing
 * - Multisig witness script construction
 * - Multisig input finalization
 * - Decoy output amount generation
 */

// Types
export type { Bip32DerivationEntry } from './types';

// BIP32 Derivations
export { buildMultisigBip32Derivations } from './bip32Derivations';

// Witness Script
export { buildMultisigWitnessScript, parseMultisigScript } from './witnessScript';

// Multisig Finalization
export { finalizeMultisigInput, witnessStackToScriptWitness } from './multisigFinalization';

// Decoy Amounts
export { generateDecoyAmounts } from './decoyAmounts';
