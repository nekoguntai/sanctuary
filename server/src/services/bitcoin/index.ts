/**
 * Bitcoin Services
 *
 * Barrel file exporting all bitcoin-related service modules.
 */

// PSBT Building
export {
  buildMultisigBip32Derivations,
  buildMultisigWitnessScript,
  parseMultisigScript,
  finalizeMultisigInput,
  witnessStackToScriptWitness,
  generateDecoyAmounts,
  type Bip32DerivationEntry,
} from './psbtBuilder';

// UTXO Selection
export {
  selectUTXOs,
  getSpendableUTXOs,
  UTXOSelectionStrategy,
  type SelectedUTXO,
  type UTXOSelectionResult,
} from './utxoSelection';

// Transaction Estimation
export {
  estimateTransaction,
  getDustThreshold,
  type TransactionEstimate,
} from './estimation';

// PSBT Info
export {
  getPSBTInfo,
  getPSBTInfoWithNetwork,
  type PSBTInfo,
  type PSBTInputInfo,
  type PSBTOutputInfo,
} from './psbtInfo';

// Transaction Service (main exports)
export {
  createTransaction,
  createBatchTransaction,
  broadcastAndSave,
  createAndBroadcastTransaction,
  type TransactionOutput,
  type TransactionInputMetadata,
  type TransactionOutputMetadata,
} from './transactionService';

// Blockchain
export { broadcastTransaction, recalculateWalletBalances } from './blockchain';

// Utils
export { getNetwork, estimateTransactionSize, calculateFee } from './utils';

// Address Derivation
export { parseDescriptor, convertToStandardXpub, type MultisigKeyInfo } from './addressDerivation';
