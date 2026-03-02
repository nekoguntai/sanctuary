/**
 * Reference Transactions
 *
 * Fetches raw transactions from the server for Trezor signing verification.
 */

import * as bitcoin from 'bitcoinjs-lib';
import apiClient from '../../../../src/api/client';
import { createLogger } from '../../../../utils/logger';

const log = createLogger('TrezorAdapter');

/**
 * Fetch reference transactions needed for Trezor signing
 */
export const fetchRefTxs = async (psbt: bitcoin.Psbt): Promise<any[]> => {
  const refTxs: any[] = [];
  const seenTxids = new Set<string>();

  for (const input of psbt.data.inputs) {
    const txInput = psbt.txInputs[psbt.data.inputs.indexOf(input)];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');

    if (seenTxids.has(txid)) continue;
    seenTxids.add(txid);

    try {
      const response = await apiClient.get<{ hex: string }>(`/transactions/${txid}/raw`);
      const rawTx = bitcoin.Transaction.fromHex(response.hex);

      const refTx = {
        hash: txid,
        version: rawTx.version,
        lock_time: rawTx.locktime,
        inputs: rawTx.ins.map(input => ({
          prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
          prev_index: input.index,
          script_sig: input.script.toString('hex'),
          sequence: input.sequence,
        })),
        bin_outputs: rawTx.outs.map(output => ({
          amount: output.value,
          script_pubkey: output.script.toString('hex'),
        })),
      };

      refTxs.push(refTx);
    } catch (error) {
      log.warn('Failed to fetch reference transaction', { txid, error });
    }
  }

  return refTxs;
};
