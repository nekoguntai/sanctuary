/**
 * PSBT Info Module
 *
 * Utilities for parsing and extracting information from PSBTs.
 */

import * as bitcoin from 'bitcoinjs-lib';

/**
 * PSBT input information
 */
export interface PSBTInputInfo {
  txid: string;
  vout: number;
  value: number;
}

/**
 * PSBT output information
 */
export interface PSBTOutputInfo {
  address?: string;
  value: number;
  isChange: boolean;
}

/**
 * Complete PSBT information
 */
export interface PSBTInfo {
  inputs: PSBTInputInfo[];
  outputs: PSBTOutputInfo[];
  fee: number;
}

/**
 * Get transaction info from PSBT for hardware wallet display
 *
 * @param psbtBase64 - Base64-encoded PSBT
 * @returns Parsed PSBT information including inputs, outputs, and fee
 */
export function getPSBTInfo(psbtBase64: string): PSBTInfo {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

  // Get inputs
  const inputs = psbt.data.inputs.map((input, index) => {
    const txInput = psbt.txInputs[index];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');
    const vout = txInput.index;
    const value = input.witnessUtxo?.value || 0;

    return { txid, vout, value };
  });

  // Get outputs
  const outputs = psbt.txOutputs.map((output) => {
    let address: string | undefined;
    try {
      address = bitcoin.address.fromOutputScript(
        output.script,
        bitcoin.networks.bitcoin
      );
    } catch (e) {
      // Some outputs might not have addresses (e.g., OP_RETURN)
    }

    return {
      address,
      value: output.value,
      isChange: false, // Would need wallet context to determine this
    };
  });

  // Calculate fee
  const totalInput = inputs.reduce((sum, input) => sum + input.value, 0);
  const totalOutput = outputs.reduce((sum, output) => sum + output.value, 0);
  const fee = totalInput - totalOutput;

  return {
    inputs,
    outputs,
    fee,
  };
}

/**
 * Get PSBT info with network-aware address parsing
 *
 * @param psbtBase64 - Base64-encoded PSBT
 * @param network - Bitcoin network ('mainnet' or 'testnet')
 * @returns Parsed PSBT information
 */
export function getPSBTInfoWithNetwork(psbtBase64: string, network: 'mainnet' | 'testnet'): PSBTInfo {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
  const networkObj = network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

  // Get inputs
  const inputs = psbt.data.inputs.map((input, index) => {
    const txInput = psbt.txInputs[index];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');
    const vout = txInput.index;
    const value = input.witnessUtxo?.value || 0;

    return { txid, vout, value };
  });

  // Get outputs
  const outputs = psbt.txOutputs.map((output) => {
    let address: string | undefined;
    try {
      address = bitcoin.address.fromOutputScript(output.script, networkObj);
    } catch (e) {
      // Some outputs might not have addresses (e.g., OP_RETURN)
    }

    return {
      address,
      value: output.value,
      isChange: false,
    };
  });

  // Calculate fee
  const totalInput = inputs.reduce((sum, input) => sum + input.value, 0);
  const totalOutput = outputs.reduce((sum, output) => sum + output.value, 0);
  const fee = totalInput - totalOutput;

  return {
    inputs,
    outputs,
    fee,
  };
}
