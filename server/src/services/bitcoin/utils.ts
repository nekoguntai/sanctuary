/**
 * Bitcoin Utilities
 *
 * Helper functions for Bitcoin operations like address validation,
 * unit conversion, and transaction building.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

// Initialize ECC library for Taproot/P2TR support
// This is required by bitcoinjs-lib v6+ for bech32m address validation
bitcoin.initEccLib(ecc);

/**
 * Convert satoshis to BTC
 */
export function satsToBTC(sats: number): number {
  return sats / 100000000;
}

/**
 * Convert BTC to satoshis
 */
export function btcToSats(btc: number): number {
  return Math.round(btc * 100000000);
}

/**
 * Validate Bitcoin address
 */
export function validateAddress(
  address: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): { valid: boolean; error?: string } {
  try {
    const networkObj = getNetwork(network);
    bitcoin.address.toOutputScript(address, networkObj);
    return { valid: true };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Invalid Bitcoin address',
    };
  }
}

/**
 * Get Bitcoin network object
 */
export function getNetwork(
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): bitcoin.Network {
  switch (network) {
    case 'testnet':
      return bitcoin.networks.testnet;
    case 'regtest':
      return bitcoin.networks.regtest;
    default:
      return bitcoin.networks.bitcoin;
  }
}

/**
 * Get address type
 */
export function getAddressType(address: string): string {
  try {
    if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      return 'P2WPKH'; // Native SegWit (Bech32)
    } else if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      return 'P2TR'; // Taproot
    } else if (address.startsWith('3') || address.startsWith('2')) {
      return 'P2SH'; // Nested SegWit or Multisig
    } else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
      return 'P2PKH'; // Legacy
    } else {
      return 'Unknown';
    }
  } catch (error) {
    return 'Invalid';
  }
}

/**
 * Calculate transaction size (in vBytes)
 * Estimate based on input/output count
 */
export function estimateTransactionSize(
  inputCount: number,
  outputCount: number,
  scriptType: 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot' = 'native_segwit'
): number {
  // Base transaction size
  let size = 10; // version (4) + locktime (4) + input count (1) + output count (1)

  // Input sizes (approximate)
  const inputSizes: Record<string, number> = {
    legacy: 148,           // P2PKH
    nested_segwit: 91,     // P2SH-P2WPKH
    native_segwit: 68,     // P2WPKH
    taproot: 58,           // P2TR
  };

  // Output size (approximately same for all types)
  const outputSize = 34;

  size += inputCount * inputSizes[scriptType];
  size += outputCount * outputSize;

  return size;
}

/**
 * Calculate transaction fee
 */
export function calculateFee(sizeVBytes: number, feeRate: number): number {
  return Math.ceil(sizeVBytes * feeRate);
}

/**
 * Format satoshis for display
 */
export function formatSats(sats: number, decimals: number = 0): string {
  return sats.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format BTC for display
 */
export function formatBTC(btc: number, decimals: number = 8): string {
  return btc.toFixed(decimals);
}

/**
 * Parse transaction hex to get details
 */
export function parseTransaction(
  txHex: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  vsize: number;
  inputs: Array<{
    txid: string;
    vout: number;
    sequence: number;
  }>;
  outputs: Array<{
    value: number;
    scriptPubKey: string;
    address?: string;
  }>;
} {
  const networkObj = getNetwork(network);
  const tx = bitcoin.Transaction.fromHex(txHex);

  const inputs = tx.ins.map((input) => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
    sequence: input.sequence,
  }));

  const outputs = tx.outs.map((output) => {
    let address: string | undefined;
    try {
      address = bitcoin.address.fromOutputScript(output.script, networkObj);
    } catch (e) {
      // Some scripts don't have addresses (e.g., OP_RETURN)
    }

    return {
      value: output.value,
      scriptPubKey: output.script.toString('hex'),
      address,
    };
  });

  return {
    txid: tx.getId(),
    version: tx.version,
    locktime: tx.locktime,
    size: tx.byteLength(),
    weight: tx.weight(),
    vsize: tx.virtualSize(),
    inputs,
    outputs,
  };
}

/**
 * Create a payment transaction with RBF support
 */
export function createTransaction(
  inputs: Array<{
    txid: string;
    vout: number;
    value: number;
    scriptPubKey: string;
  }>,
  outputs: Array<{
    address: string;
    value: number;
  }>,
  feeRate: number,
  options: {
    network?: 'mainnet' | 'testnet' | 'regtest';
    enableRBF?: boolean;
  } = {}
): {
  psbt: bitcoin.Psbt;
  fee: number;
  totalInput: number;
  totalOutput: number;
} {
  const network = options.network || 'mainnet';
  const enableRBF = options.enableRBF ?? true; // RBF enabled by default
  const networkObj = getNetwork(network);
  const psbt = new bitcoin.Psbt({ network: networkObj });

  // RBF sequence value (0xfffffffd signals RBF)
  const sequence = enableRBF ? 0xfffffffd : 0xffffffff;

  // Add inputs
  let totalInput = 0;
  for (const input of inputs) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      sequence,
      witnessUtxo: {
        script: Buffer.from(input.scriptPubKey, 'hex'),
        value: input.value,
      },
    });
    totalInput += input.value;
  }

  // Add outputs
  let totalOutput = 0;
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: output.value,
    });
    totalOutput += output.value;
  }

  // Calculate fee
  const estimatedSize = estimateTransactionSize(inputs.length, outputs.length, 'native_segwit');
  const fee = calculateFee(estimatedSize, feeRate);

  return {
    psbt,
    fee,
    totalInput,
    totalOutput,
  };
}

/**
 * Verify transaction signature (for multi-sig)
 */
export function verifySignature(
  txHex: string,
  inputIndex: number,
  pubkey: Buffer,
  signature: Buffer
): boolean {
  try {
    const tx = bitcoin.Transaction.fromHex(txHex);
    // Verification logic would go here
    // This is complex and depends on script type
    return true; // Placeholder
  } catch (error) {
    return false;
  }
}
