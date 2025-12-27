/**
 * Blockchain Service
 *
 * High-level service for interacting with the Bitcoin blockchain.
 * Handles address monitoring, transaction fetching, and UTXO management.
 */

import { getNodeClient } from './nodeClient';
import { getElectrumPool } from './electrumPool';
import prisma from '../../models/prisma';
import { validateAddress, parseTransaction, getNetwork } from './utils';
import { createLogger } from '../../utils/logger';
import { walletLog } from '../../websocket/notifications';

// Import modular utilities
import {
  getCachedBlockHeight,
  setCachedBlockHeight,
  getBlockHeight,
  getBlockTimestamp,
} from './utils/blockHeight';
import { recalculateWalletBalances } from './utils/balanceCalculation';
import { ensureGapLimit } from './sync/addressDiscovery';
import {
  updateTransactionConfirmations,
  populateMissingTransactionFields,
  type ConfirmationUpdate,
  type PopulateFieldsResult,
} from './sync/confirmations';

// Re-export for backward compatibility
export {
  getCachedBlockHeight,
  setCachedBlockHeight,
  getBlockHeight,
  recalculateWalletBalances,
  ensureGapLimit,
  updateTransactionConfirmations,
  populateMissingTransactionFields,
  type ConfirmationUpdate,
  type PopulateFieldsResult,
};

const log = createLogger('BLOCKCHAIN');

/**
 * Sync address with blockchain
 * Fetches transactions and UTXOs for an address and updates database
 */
export async function syncAddress(addressId: string): Promise<{
  transactions: number;
  utxos: number;
}> {
  const addressRecord = await prisma.address.findUnique({
    where: { id: addressId },
    include: { wallet: true },
  });

  if (!addressRecord) {
    throw new Error('Address not found');
  }

  const client = await getNodeClient();

  try {
    // Get transaction history
    const history = await client.getAddressHistory(addressRecord.address);

    let transactionCount = 0;
    let utxoCount = 0;

    // Helper to check if output matches our address
    // Handles both legacy format (addresses array) and segwit format (address singular)
    const outputMatchesAddress = (out: any, address: string): boolean => {
      if (out.scriptPubKey?.address === address) return true;
      if (out.scriptPubKey?.addresses?.includes(address)) return true;
      return false;
    };

    // Get all wallet addresses for checking inputs (to detect sends)
    const walletAddresses = await prisma.address.findMany({
      where: { walletId: addressRecord.walletId },
      select: { address: true },
    });
    const walletAddressSet = new Set(walletAddresses.map(a => a.address));

    // Process each transaction
    for (const item of history) {
      // Fetch full transaction details
      const txDetails = await client.getTransaction(item.tx_hash);

      const outputs = txDetails.vout || [];
      const inputs = txDetails.vin || [];

      // Check if this address received funds (is in outputs)
      const isReceived = outputs.some((out: any) =>
        outputMatchesAddress(out, addressRecord.address)
      );

      // Check if this address sent funds (is in inputs)
      // Need to check previous outputs referenced by inputs
      let isSent = false;
      let totalSentFromWallet = 0;

      for (const input of inputs) {
        // Skip coinbase inputs
        if (input.coinbase) continue;

        let inputAddr: string | undefined;
        let inputValue: number | undefined;

        // Check if input has prevout info (verbose mode from server)
        if (input.prevout && input.prevout.scriptPubKey) {
          inputAddr = input.prevout.scriptPubKey.address ||
            (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
          inputValue = input.prevout.value;
        } else if (input.txid && input.vout !== undefined) {
          // Need to look up the previous transaction to find the input address
          try {
            const prevTx = await client.getTransaction(input.txid);
            if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
              const prevOutput = prevTx.vout[input.vout];
              inputAddr = prevOutput.scriptPubKey?.address ||
                (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
              inputValue = prevOutput.value;
            }
          } catch (e) {
            // Skip if we can't look up the prev tx
            log.warn(`[BLOCKCHAIN] Failed to look up input tx ${input.txid}`, { error: String(e) });
          }
        }

        if (inputAddr && walletAddressSet.has(inputAddr)) {
          isSent = true;
          if (inputValue) {
            totalSentFromWallet += Math.round(inputValue * 100000000);
          }
        }
      }

      // Get block timestamp - prefer txDetails.time, fall back to block header
      let blockTime: Date | null = null;
      if (txDetails.time) {
        blockTime = new Date(txDetails.time * 1000);
      } else if (item.height > 0) {
        // Derive timestamp from block header
        blockTime = await getBlockTimestamp(item.height);
      }

      if (isReceived) {
        // Check if we already recorded this as a received tx
        const existingReceivedTx = await prisma.transaction.findFirst({
          where: { txid: item.tx_hash, walletId: addressRecord.walletId, type: 'received' },
        });

        if (!existingReceivedTx) {
          const amount = outputs
            .filter((out: any) =>
              outputMatchesAddress(out, addressRecord.address)
            )
            .reduce((sum: number, out: any) => sum + Math.round(out.value * 100000000), 0);

          // Create receive transaction record
          await prisma.transaction.create({
            data: {
              txid: item.tx_hash,
              walletId: addressRecord.walletId,
              addressId: addressRecord.id,
              type: 'received',
              amount: BigInt(amount),
              confirmations: item.height > 0 ? await getConfirmations(item.height) : 0,
              blockHeight: item.height > 0 ? item.height : null,
              blockTime,
            },
          });

          transactionCount++;
        }
      }

      // Record sent transaction if our wallet addresses were in inputs
      // This detects when we're spending from this wallet (even if we also receive change)
      if (isSent) {
        // Calculate outputs to external addresses and back to wallet (change)
        let totalToExternal = 0;
        let totalToWallet = 0;
        for (const out of outputs) {
          const outAddr = out.scriptPubKey?.address ||
            (out.scriptPubKey?.addresses && out.scriptPubKey.addresses[0]);
          const outValue = Math.round(out.value * 100000000);
          if (outAddr && !walletAddressSet.has(outAddr)) {
            totalToExternal += outValue;
          } else if (outAddr) {
            totalToWallet += outValue;
          }
        }

        // Calculate fee: inputs - all outputs
        const fee = totalSentFromWallet - totalToExternal - totalToWallet;

        if (totalToExternal > 0) {
          // Regular send to external address
          const existingSentTx = await prisma.transaction.findFirst({
            where: { txid: item.tx_hash, walletId: addressRecord.walletId, type: 'sent' },
          });

          if (!existingSentTx) {
            // Amount is negative (funds leaving wallet = amount sent + fee)
            const sentAmount = -(totalToExternal + fee);
            await prisma.transaction.create({
              data: {
                txid: item.tx_hash,
                walletId: addressRecord.walletId,
                addressId: addressRecord.id,
                type: 'sent',
                amount: BigInt(sentAmount),
                fee: BigInt(fee),
                confirmations: item.height > 0 ? await getConfirmations(item.height) : 0,
                blockHeight: item.height > 0 ? item.height : null,
                blockTime,
              },
            });

            transactionCount++;
          }
        } else if (totalToWallet > 0) {
          // Consolidation - all outputs go back to wallet
          const existingConsolidationTx = await prisma.transaction.findFirst({
            where: { txid: item.tx_hash, walletId: addressRecord.walletId, type: 'consolidation' },
          });

          if (!existingConsolidationTx) {
            // Amount is negative fee (only fee is lost in consolidation)
            await prisma.transaction.create({
              data: {
                txid: item.tx_hash,
                walletId: addressRecord.walletId,
                addressId: addressRecord.id,
                type: 'consolidation',
                amount: BigInt(-fee),
                fee: BigInt(fee),
                confirmations: item.height > 0 ? await getConfirmations(item.height) : 0,
                blockHeight: item.height > 0 ? item.height : null,
                blockTime,
              },
            });

            transactionCount++;
          }
        }
      }
    }

    // Get and process UTXOs
    const utxos = await client.getAddressUTXOs(addressRecord.address);

    for (const utxo of utxos) {
      const existingUtxo = await prisma.uTXO.findUnique({
        where: {
          txid_vout: {
            txid: utxo.tx_hash,
            vout: utxo.tx_pos,
          },
        },
      });

      if (!existingUtxo) {
        // Fetch transaction to get scriptPubKey
        const txDetails = await client.getTransaction(utxo.tx_hash);
        const output = txDetails.vout[utxo.tx_pos];

        await prisma.uTXO.create({
          data: {
            walletId: addressRecord.walletId,
            txid: utxo.tx_hash,
            vout: utxo.tx_pos,
            address: addressRecord.address,
            amount: BigInt(utxo.value),
            scriptPubKey: output.scriptPubKey.hex,
            confirmations: utxo.height > 0 ? await getConfirmations(utxo.height) : 0,
            blockHeight: utxo.height > 0 ? utxo.height : null,
            spent: false,
          },
        });

        utxoCount++;
      }
    }

    // Mark address as used if it has transactions
    if (history.length > 0 && !addressRecord.used) {
      await prisma.address.update({
        where: { id: addressId },
        data: { used: true },
      });
    }

    // Store transaction inputs/outputs for newly created transactions
    if (transactionCount > 0) {
      try {
        // Get transactions created in this sync that don't have I/O stored
        const txsWithoutIO = await prisma.transaction.findMany({
          where: {
            walletId: addressRecord.walletId,
            txid: { in: history.map(h => h.tx_hash) },
            inputs: { none: {} },
            outputs: { none: {} },
          },
          select: { id: true, txid: true, type: true },
        });

        for (const txRecord of txsWithoutIO) {
          const txDetails = await client.getTransaction(txRecord.txid, true);
          if (!txDetails) continue;

          const inputs = txDetails.vin || [];
          const outputs = txDetails.vout || [];

          // Store inputs
          for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
            const input = inputs[inputIdx];
            if (input.coinbase) continue;

            let inputAddress: string | undefined;
            let inputAmount = 0;

            if (input.prevout && input.prevout.scriptPubKey) {
              inputAddress = input.prevout.scriptPubKey.address ||
                (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
              if (input.prevout.value !== undefined) {
                inputAmount = input.prevout.value >= 1000000
                  ? input.prevout.value
                  : Math.round(input.prevout.value * 100000000);
              }
            }

            if (inputAddress && input.txid !== undefined && input.vout !== undefined) {
              await prisma.transactionInput.upsert({
                where: {
                  transactionId_inputIndex: { transactionId: txRecord.id, inputIndex: inputIdx },
                },
                create: {
                  transactionId: txRecord.id,
                  inputIndex: inputIdx,
                  txid: input.txid,
                  vout: input.vout,
                  address: inputAddress,
                  amount: BigInt(inputAmount),
                },
                update: {},
              });
            }
          }

          // Store outputs
          for (let outputIdx = 0; outputIdx < outputs.length; outputIdx++) {
            const output = outputs[outputIdx];
            const outputAddress = output.scriptPubKey?.address ||
              (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);

            if (!outputAddress) continue;

            const outputAmount = Math.round((output.value || 0) * 100000000);
            const isOurs = walletAddressSet.has(outputAddress);

            let outputType = 'unknown';
            if (txRecord.type === 'sent') {
              outputType = isOurs ? 'change' : 'recipient';
            } else if (txRecord.type === 'received') {
              outputType = isOurs ? 'recipient' : 'unknown';
            } else if (txRecord.type === 'consolidation') {
              outputType = 'consolidation';
            }

            await prisma.transactionOutput.upsert({
              where: {
                transactionId_outputIndex: { transactionId: txRecord.id, outputIndex: outputIdx },
              },
              create: {
                transactionId: txRecord.id,
                outputIndex: outputIdx,
                address: outputAddress,
                amount: BigInt(outputAmount),
                scriptPubKey: output.scriptPubKey?.hex,
                outputType,
                isOurs,
              },
              update: {},
            });
          }
        }

        log.debug(`[BLOCKCHAIN] Stored I/O for ${txsWithoutIO.length} transactions in address sync`);
      } catch (ioError) {
        log.warn(`[BLOCKCHAIN] Failed to store transaction I/O in address sync: ${ioError}`);
      }
    }

    return {
      transactions: transactionCount,
      utxos: utxoCount,
    };
  } catch (error) {
    log.error('[BLOCKCHAIN] Sync address error', { error: String(error) });
    throw error;
  }
}

/**
 * Sync all addresses for a wallet - OPTIMIZED with parallel processing and batch operations
 */
export async function syncWallet(walletId: string): Promise<{
  addresses: number;
  transactions: number;
  utxos: number;
}> {
  const startTime = Date.now();

  // Get wallet to determine network
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }
  const network = (wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';

  // Check if Tor proxy is enabled for this sync
  const pool = getElectrumPool();
  const viaTor = pool.isProxyEnabled();

  walletLog(walletId, 'info', 'SYNC', viaTor ? 'Starting wallet sync via Tor...' : 'Starting wallet sync...', { viaTor });
  const client = await getNodeClient(network);


  // Get all addresses for the wallet
  const addresses = await prisma.address.findMany({
    where: { walletId },
  });

  if (addresses.length === 0) {
    walletLog(walletId, 'info', 'BLOCKCHAIN', 'No addresses to scan');
    return { addresses: 0, transactions: 0, utxos: 0 };
  }

  const walletAddressSet = new Set(addresses.map(a => a.address));
  const addressMap = new Map(addresses.map(a => [a.address, a]));

  // Count receive vs change addresses
  const receiveAddrs = addresses.filter(a => a.derivationPath?.includes('/0/')).length;
  const changeAddrs = addresses.filter(a => a.derivationPath?.includes('/1/')).length;
  walletLog(walletId, 'info', 'BLOCKCHAIN', `Scanning ${addresses.length} addresses`, {
    receive: receiveAddrs,
    change: changeAddrs,
  });

  // Cleanup: Mark any pending transactions as replaced if their inputs are already spent
  // This catches edge cases where UTXOs were marked spent before this logic was deployed
  const staleReplacedTxs = await prisma.$queryRaw<Array<{ id: string; txid: string }>>`
    SELECT DISTINCT t.id, t.txid
    FROM transactions t
    JOIN transaction_inputs ti ON ti."transactionId" = t.id
    JOIN utxos u ON u.txid = ti.txid AND u.vout = ti.vout
    WHERE t."walletId" = ${walletId}
      AND t.confirmations = 0
      AND t."rbfStatus" = 'active'
      AND u.spent = true
  `;

  if (staleReplacedTxs.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: staleReplacedTxs.map(tx => tx.id) } },
      data: { rbfStatus: 'replaced' },
    });
    walletLog(
      walletId,
      'info',
      'TX',
      `Cleanup: Marked ${staleReplacedTxs.length} stale pending transaction(s) as replaced: ${staleReplacedTxs.map(tx => tx.txid.slice(0, 8)).join(', ')}`
    );
  }

  // PHASE 1: Batch fetch all address histories using true RPC batching
  walletLog(walletId, 'info', 'SYNC', `Fetching address histories (${addresses.length} addresses)...`);
  log.debug(`[BLOCKCHAIN] Fetching history for ${addresses.length} addresses using batch RPC...`);
  const BATCH_SIZE = 50; // Number of addresses per batch RPC call
  const historyResults: Map<string, Array<{ tx_hash: string; height: number }>> = new Map();
  const totalAddressBatches = Math.ceil(addresses.length / BATCH_SIZE);

  // Process addresses in batches for true RPC batching
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batchAddresses = addresses.slice(i, i + BATCH_SIZE).map(a => a.address);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Log progress for larger wallets
    if (addresses.length > BATCH_SIZE) {
      walletLog(walletId, 'debug', 'SYNC', `Address history batch ${batchNum}/${totalAddressBatches}...`);
    }

    try {
      const batchResults = await client.getAddressHistoryBatch(batchAddresses);
      // Merge results into historyResults
      for (const [addr, history] of batchResults) {
        historyResults.set(addr, history);
      }
    } catch (error) {
      log.warn(`[BLOCKCHAIN] Batch history failed, falling back to individual requests`, { error: String(error) });
      // Fallback to individual requests if batch fails
      for (const addr of batchAddresses) {
        try {
          const history = await client.getAddressHistory(addr);
          historyResults.set(addr, history);
        } catch (e) {
          log.warn(`[BLOCKCHAIN] Failed to get history for ${addr}`, { error: String(e) });
          historyResults.set(addr, []);
        }
      }
    }
  }

  // Collect all unique txids from all address histories
  const allTxids = new Set<string>();
  let addressesWithActivity = 0;
  for (const [addr, history] of historyResults.entries()) {
    if (history.length > 0) {
      addressesWithActivity++;
    }
    for (const item of history) {
      allTxids.add(item.tx_hash);
    }
  }

  walletLog(walletId, 'info', 'SYNC', `Found ${allTxids.size} transactions across ${addressesWithActivity} active addresses`);

  // PHASE 2: Batch check which transactions already exist in DB
  walletLog(walletId, 'debug', 'SYNC', `Phase 2: Checking ${allTxids.size} transactions against database...`);
  const existingTxs = await prisma.transaction.findMany({
    where: {
      walletId,
      txid: { in: Array.from(allTxids) },
    },
    select: { txid: true, type: true },
  });
  const existingTxMap = new Map(existingTxs.map(tx => [`${tx.txid}:${tx.type}`, true]));
  const existingTxidSet = new Set(existingTxs.map(tx => tx.txid));

  // Filter to only new txids
  const newTxids = Array.from(allTxids).filter(txid => !existingTxidSet.has(txid));
  log.debug(`[BLOCKCHAIN] Found ${newTxids.length} new transactions to process (${existingTxidSet.size} already exist)`);

  if (newTxids.length > 0) {
    walletLog(walletId, 'info', 'BLOCKCHAIN', `Fetching ${newTxids.length} new transactions`, {
      existing: existingTxidSet.size,
    });
  }

  // PHASE 3/4/5 COMBINED: Incremental fetch, process, and insert
  // This ensures progress is saved to DB as we go, so retries can continue where they left off
  if (newTxids.length > 0) {
    walletLog(walletId, 'info', 'SYNC', `Processing ${newTxids.length} new transactions...`);
  }
  const txDetailsCache: Map<string, any> = new Map();
  const TX_BATCH_SIZE = 10; // Reduced from 25 to avoid server rate limiting
  const currentHeight = await getBlockHeight();
  let totalTransactions = 0;

  // Build txid -> height map from histories
  const txHeightMap = new Map<string, number>();
  for (const history of historyResults.values()) {
    for (const item of history) {
      txHeightMap.set(item.tx_hash, item.height);
    }
  }

  // Helper to check if output matches an address
  const outputMatchesAddress = (out: any, address: string): boolean => {
    if (out.scriptPubKey?.address === address) return true;
    if (out.scriptPubKey?.addresses?.includes(address)) return true;
    return false;
  };

  // Build address to derivation path map for input derivation paths
  const addressToDerivationPath = new Map<string, string>();
  for (const addr of addresses) {
    if (addr.derivationPath) {
      addressToDerivationPath.set(addr.address, addr.derivationPath);
    }
  }

  // Track all new transactions across batches for final stats
  const allNewTransactions: any[] = [];

  // INCREMENTAL SYNC: Process transactions in batches, saving to DB after each batch
  // This ensures progress is preserved even if sync is interrupted
  for (let batchIndex = 0; batchIndex < newTxids.length; batchIndex += TX_BATCH_SIZE) {
    const batchTxids = newTxids.slice(batchIndex, batchIndex + TX_BATCH_SIZE);
    const batchNumber = Math.floor(batchIndex / TX_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(newTxids.length / TX_BATCH_SIZE);

    // Log progress for all syncs with new transactions
    walletLog(walletId, 'info', 'SYNC', `Fetching transactions ${batchIndex + 1}-${Math.min(batchIndex + TX_BATCH_SIZE, newTxids.length)} of ${newTxids.length}...`);

    // Step 1: Fetch this batch of transactions
    try {
      const batchResults = await client.getTransactionsBatch(batchTxids, true);
      // Merge results into cache (accumulates for input lookups)
      for (const [txid, details] of batchResults) {
        txDetailsCache.set(txid, details);
      }
    } catch (error) {
      log.warn(`[BLOCKCHAIN] Batch tx fetch failed, falling back to individual requests`, { error: String(error) });
      // Fallback to individual requests if batch fails
      for (const txid of batchTxids) {
        try {
          const details = await client.getTransaction(txid, true);
          txDetailsCache.set(txid, details);
        } catch (e) {
          log.warn(`[BLOCKCHAIN] Failed to get tx ${txid}`, { error: String(e) });
        }
      }
    }

    // Create a set of txids in this batch that were successfully fetched
    const batchTxidSet = new Set(batchTxids.filter(txid => txDetailsCache.has(txid)));

    // Step 2: Process ONLY transactions in this batch
    const transactionsToCreate: any[] = [];

    for (const [addressStr, history] of historyResults) {
      const addressRecord = addressMap.get(addressStr)!;

      for (const item of history) {
        // Skip if not in this batch
        if (!batchTxidSet.has(item.tx_hash)) continue;

        const txDetails = txDetailsCache.get(item.tx_hash);
        if (!txDetails) continue;

        const outputs = txDetails.vout || [];
        const inputs = txDetails.vin || [];

        // Check if this address received funds
        const isReceived = outputs.some((out: any) => outputMatchesAddress(out, addressStr));

        // Get block timestamp
        let blockTime: Date | null = null;
        if (txDetails.time) {
          blockTime = new Date(txDetails.time * 1000);
        } else if (item.height > 0) {
          blockTime = await getBlockTimestamp(item.height);
        }

        const confirmations = item.height > 0 ? Math.max(0, currentHeight - item.height + 1) : 0;

        // First, check if wallet sent funds (any wallet address in inputs)
        // This is needed to detect consolidations BEFORE creating received records
        let isSent = false;
        for (const input of inputs) {
          if (input.coinbase) continue;

          let inputAddr: string | undefined;
          if (input.prevout && input.prevout.scriptPubKey) {
            inputAddr = input.prevout.scriptPubKey.address ||
              (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
          } else if (input.txid && input.vout !== undefined) {
            // Electrum doesn't provide prevout, so look up the previous transaction
            // First check if we have it cached
            const prevTx = txDetailsCache.get(input.txid);
            if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
              const prevOutput = prevTx.vout[input.vout];
              inputAddr = prevOutput.scriptPubKey?.address ||
                (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
            } else {
              // Need to fetch the previous transaction
              try {
                const fetchedPrevTx = await client.getTransaction(input.txid);
                if (fetchedPrevTx && fetchedPrevTx.vout && fetchedPrevTx.vout[input.vout]) {
                  const prevOutput = fetchedPrevTx.vout[input.vout];
                  inputAddr = prevOutput.scriptPubKey?.address ||
                    (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
                  // Cache it for future use
                  txDetailsCache.set(input.txid, fetchedPrevTx);
                }
              } catch (e) {
                // Skip if we can't look up the prev tx
              }
            }
          }

          if (inputAddr && walletAddressSet.has(inputAddr)) {
            isSent = true;
            break;
          }
        }

        // Calculate output destinations and total outputs
        let totalToExternal = 0;
        let totalToWallet = 0;
        let totalOutputs = 0;
        for (const out of outputs) {
          const outValue = Math.round(out.value * 100000000);
          totalOutputs += outValue;
          const outAddr = out.scriptPubKey?.address ||
            (out.scriptPubKey?.addresses && out.scriptPubKey.addresses[0]);
          if (outAddr && !walletAddressSet.has(outAddr)) {
            totalToExternal += outValue;
          } else if (outAddr) {
            totalToWallet += outValue;
          }
        }

        // Calculate total inputs for fee calculation (only for sent/consolidation txs)
        let totalInputs = 0;
        if (isSent) {
          for (const input of inputs) {
            if (input.coinbase) continue;

            let inputValue = 0;
            if (input.prevout && input.prevout.value !== undefined) {
              // mempool.space/esplora format - value in sats or BTC
              inputValue = input.prevout.value >= 1000000
                ? input.prevout.value  // already in sats
                : Math.round(input.prevout.value * 100000000);  // BTC to sats
            } else if (input.txid && input.vout !== undefined) {
              // Look up from cached transaction
              const prevTx = txDetailsCache.get(input.txid);
              if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                inputValue = Math.round(prevTx.vout[input.vout].value * 100000000);
              }
            }
            totalInputs += inputValue;
          }
        }

        // Calculate fee (only meaningful for sent/consolidation transactions)
        const fee = isSent && totalInputs > 0 ? totalInputs - totalOutputs : null;

        // Determine transaction type and create appropriate record
        // Priority: consolidation > sent > received
        // A consolidation is when funds move within wallet (inputs from wallet, all outputs to wallet)
        const isConsolidation = isSent && totalToExternal === 0 && totalToWallet > 0;

        if (isConsolidation && !existingTxMap.has(`${item.tx_hash}:consolidation`)) {
          // Consolidation - funds moved within wallet, only fee is lost
          // Amount is negative (fee paid)
          const consolidationAmount = fee !== null ? -fee : 0;
          transactionsToCreate.push({
            txid: item.tx_hash,
            walletId,
            addressId: addressRecord.id,
            type: 'consolidation',
            amount: BigInt(consolidationAmount),
            fee: fee !== null ? BigInt(fee) : null,
            confirmations,
            blockHeight: item.height > 0 ? item.height : null,
            blockTime,
          });
          existingTxMap.set(`${item.tx_hash}:consolidation`, true);
        } else if (isSent && totalToExternal > 0 && !existingTxMap.has(`${item.tx_hash}:sent`)) {
          // Regular send to external address
          // Amount is negative (funds leaving wallet = amount sent + fee)
          const sentAmount = -(totalToExternal + (fee ?? 0));
          transactionsToCreate.push({
            txid: item.tx_hash,
            walletId,
            addressId: addressRecord.id,
            type: 'sent',
            amount: BigInt(sentAmount),
            fee: fee !== null ? BigInt(fee) : null,
            confirmations,
            blockHeight: item.height > 0 ? item.height : null,
            blockTime,
          });
          existingTxMap.set(`${item.tx_hash}:sent`, true);
        } else if (!isSent && isReceived && !existingTxMap.has(`${item.tx_hash}:received`)) {
          // Received from external - only if NOT sent from wallet (not consolidation)
          // Sum ALL outputs to ANY wallet address (handles batched payouts with multiple outputs to same wallet)
          const amount = outputs
            .filter((out: any) => {
              const outAddr = out.scriptPubKey?.address || out.scriptPubKey?.addresses?.[0];
              return outAddr && walletAddressSet.has(outAddr);
            })
            .reduce((sum: number, out: any) => sum + Math.round(out.value * 100000000), 0);

          transactionsToCreate.push({
            txid: item.tx_hash,
            walletId,
            addressId: addressRecord.id,
            type: 'received',
            amount: BigInt(amount),
            confirmations,
            blockHeight: item.height > 0 ? item.height : null,
            blockTime,
          });
          existingTxMap.set(`${item.tx_hash}:received`, true);
        }
      }
    }

    // Step 3: Insert this batch to DB immediately
    if (transactionsToCreate.length > 0) {
      // Deduplicate by txid:type
      const uniqueTxs = new Map<string, any>();
      for (const tx of transactionsToCreate) {
        const key = `${tx.txid}:${tx.type}`;
        if (!uniqueTxs.has(key)) {
          uniqueTxs.set(key, tx);
        }
      }

      const uniqueTxArray = Array.from(uniqueTxs.values());

      // Check which transactions already exist (to avoid duplicate notifications)
      const existingTxids = new Set(
        (await prisma.transaction.findMany({
          where: {
            walletId,
            txid: { in: uniqueTxArray.map(tx => tx.txid) },
          },
          select: { txid: true },
        })).map(tx => tx.txid)
      );

      // Filter to only truly new transactions
      const newTransactions = uniqueTxArray.filter(tx => !existingTxids.has(tx.txid));

      if (newTransactions.length > 0) {
        // Use createMany for bulk insert
        await prisma.transaction.createMany({
          data: uniqueTxArray,
          skipDuplicates: true,
        });
        totalTransactions += newTransactions.length;
        allNewTransactions.push(...newTransactions);

        // Log batch results with amounts
        const received = newTransactions.filter(t => t.type === 'received');
        const sent = newTransactions.filter(t => t.type === 'sent');
        const consolidation = newTransactions.filter(t => t.type === 'consolidation');
        const receivedTotal = received.reduce((sum, t) => sum + t.amount, BigInt(0));
        const sentTotal = sent.reduce((sum, t) => sum + t.amount, BigInt(0));

        const parts: string[] = [];
        if (received.length > 0) parts.push(`+${(Number(receivedTotal) / 100000000).toFixed(8)} BTC (${received.length} received)`);
        if (sent.length > 0) parts.push(`${(Number(sentTotal) / 100000000).toFixed(8)} BTC (${sent.length} sent)`);
        if (consolidation.length > 0) parts.push(`${consolidation.length} consolidation`);

        walletLog(walletId, 'info', 'TX', `Saved: ${parts.join(', ')}`);

        log.debug(`[BLOCKCHAIN] Batch ${batchNumber}: Inserted ${newTransactions.length} transactions`);

        // Store transaction inputs and outputs for this batch
        try {
          const createdTxRecords = await prisma.transaction.findMany({
            where: {
              walletId,
              txid: { in: newTransactions.map(tx => tx.txid) },
            },
            select: { id: true, txid: true, type: true },
          });

          const txInputsToCreate: Array<{
            transactionId: string;
            inputIndex: number;
            txid: string;
            vout: number;
            address: string;
            amount: bigint;
            derivationPath?: string;
          }> = [];

          const txOutputsToCreate: Array<{
            transactionId: string;
            outputIndex: number;
            address: string;
            amount: bigint;
            scriptPubKey?: string;
            outputType: string;
            isOurs: boolean;
          }> = [];

          for (const txRecord of createdTxRecords) {
            const txDetails = txDetailsCache.get(txRecord.txid);
            if (!txDetails) continue;

            const inputs = txDetails.vin || [];
            const outputs = txDetails.vout || [];

            // Process inputs
            for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
              const input = inputs[inputIdx];
              if (input.coinbase) continue;

              let inputAddress: string | undefined;
              let inputAmount = 0;

              if (input.prevout && input.prevout.scriptPubKey) {
                inputAddress = input.prevout.scriptPubKey.address ||
                  (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
                if (input.prevout.value !== undefined) {
                  inputAmount = input.prevout.value >= 1000000
                    ? input.prevout.value
                    : Math.round(input.prevout.value * 100000000);
                }
              } else if (input.txid && input.vout !== undefined) {
                const prevTx = txDetailsCache.get(input.txid);
                if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                  const prevOutput = prevTx.vout[input.vout];
                  inputAddress = prevOutput.scriptPubKey?.address ||
                    (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
                  if (prevOutput.value !== undefined) {
                    inputAmount = Math.round(prevOutput.value * 100000000);
                  }
                }
              }

              if (inputAddress && input.txid !== undefined && input.vout !== undefined) {
                txInputsToCreate.push({
                  transactionId: txRecord.id,
                  inputIndex: inputIdx,
                  txid: input.txid,
                  vout: input.vout,
                  address: inputAddress,
                  amount: BigInt(inputAmount),
                  derivationPath: addressToDerivationPath.get(inputAddress),
                });
              }
            }

            // Process outputs
            for (let outputIdx = 0; outputIdx < outputs.length; outputIdx++) {
              const output = outputs[outputIdx];
              const outputAddress = output.scriptPubKey?.address ||
                (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);

              if (!outputAddress) continue;

              const outputAmount = Math.round((output.value || 0) * 100000000);
              const isOurs = walletAddressSet.has(outputAddress);

              let outputType = 'unknown';
              if (txRecord.type === 'sent') {
                outputType = isOurs ? 'change' : 'recipient';
              } else if (txRecord.type === 'received') {
                outputType = isOurs ? 'recipient' : 'unknown';
              } else if (txRecord.type === 'consolidation') {
                outputType = 'consolidation';
              }

              txOutputsToCreate.push({
                transactionId: txRecord.id,
                outputIndex: outputIdx,
                address: outputAddress,
                amount: BigInt(outputAmount),
                scriptPubKey: output.scriptPubKey?.hex,
                outputType,
                isOurs,
              });
            }
          }

          if (txInputsToCreate.length > 0) {
            await prisma.transactionInput.createMany({
              data: txInputsToCreate,
              skipDuplicates: true,
            });
          }

          if (txOutputsToCreate.length > 0) {
            await prisma.transactionOutput.createMany({
              data: txOutputsToCreate,
              skipDuplicates: true,
            });
          }
        } catch (ioError) {
          log.warn(`[BLOCKCHAIN] Failed to store transaction inputs/outputs: ${ioError}`);
        }

        // Auto-apply address labels for this batch
        try {
          const addressIds = [...new Set(newTransactions.map(tx => tx.addressId).filter(Boolean))] as string[];
          if (addressIds.length > 0) {
            const addressLabels = await prisma.addressLabel.findMany({
              where: { addressId: { in: addressIds } },
            });

            if (addressLabels.length > 0) {
              const labelsByAddress = new Map<string, string[]>();
              for (const al of addressLabels) {
                const labels = labelsByAddress.get(al.addressId) || [];
                labels.push(al.labelId);
                labelsByAddress.set(al.addressId, labels);
              }

              const createdTxs = await prisma.transaction.findMany({
                where: {
                  walletId,
                  txid: { in: newTransactions.map(tx => tx.txid) },
                },
                select: { id: true, txid: true, addressId: true },
              });

              const txLabelData: { transactionId: string; labelId: string }[] = [];
              for (const tx of createdTxs) {
                if (tx.addressId) {
                  const labels = labelsByAddress.get(tx.addressId) || [];
                  for (const labelId of labels) {
                    txLabelData.push({ transactionId: tx.id, labelId });
                  }
                }
              }

              if (txLabelData.length > 0) {
                await prisma.transactionLabel.createMany({
                  data: txLabelData,
                  skipDuplicates: true,
                });
              }
            }
          }
        } catch (labelError) {
          log.warn(`[BLOCKCHAIN] Failed to auto-apply address labels: ${labelError}`);
        }

        // Send notifications for this batch (async, don't block)
        const { notifyNewTransactions } = await import('../notifications/notificationService');
        notifyNewTransactions(walletId, newTransactions.map(tx => ({
          txid: tx.txid,
          type: tx.type,
          amount: tx.amount,
        }))).catch(err => {
          log.warn(`[BLOCKCHAIN] Failed to send notifications: ${err}`);
        });

        // Broadcast WebSocket events for this batch
        const { getNotificationService } = await import('../../websocket/notifications');
        const notificationService = getNotificationService();
        for (const tx of newTransactions) {
          notificationService.broadcastTransactionNotification({
            txid: tx.txid,
            walletId,
            type: tx.type as 'received' | 'sent' | 'consolidation',
            amount: Number(tx.amount),
            confirmations: tx.confirmations || 0,
            blockHeight: tx.blockHeight ?? undefined,
            timestamp: tx.blockTime || new Date(),
          });
        }
      }
    }

    // Small delay between batches to avoid overwhelming server
    if (batchIndex + TX_BATCH_SIZE < newTxids.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Recalculate running balances once after all transactions are inserted
  if (allNewTransactions.length > 0) {
    await recalculateWalletBalances(walletId);

    // Log transaction type breakdown
    const received = allNewTransactions.filter(t => t.type === 'received').length;
    const sent = allNewTransactions.filter(t => t.type === 'sent').length;
    const consolidation = allNewTransactions.filter(t => t.type === 'consolidation').length;
    walletLog(walletId, 'info', 'BLOCKCHAIN', `Recorded ${totalTransactions} new transactions`, {
      received,
      sent,
      consolidation,
    });
  }

  // PHASE 6: Batch fetch all UTXOs for all addresses using true RPC batching
  walletLog(walletId, 'info', 'SYNC', `Fetching UTXOs (${addresses.length} addresses)...`);
  log.debug(`[BLOCKCHAIN] Fetching UTXOs for ${addresses.length} addresses using batch RPC...`);
  const utxoResults: Array<{ address: string; utxos: any[] }> = [];
  const successfullyFetchedAddresses = new Set<string>(); // Track which addresses were successfully queried
  const totalUtxoBatches = Math.ceil(addresses.length / BATCH_SIZE);

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batchAddresses = addresses.slice(i, i + BATCH_SIZE).map(a => a.address);
    const utxoBatchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Log progress for larger wallets
    if (addresses.length > BATCH_SIZE) {
      walletLog(walletId, 'debug', 'SYNC', `UTXO batch ${utxoBatchNum}/${totalUtxoBatches}...`);
    }

    try {
      const batchResults = await client.getAddressUTXOsBatch(batchAddresses);
      // Convert Map to array format
      for (const [addr, utxos] of batchResults) {
        utxoResults.push({ address: addr, utxos });
        successfullyFetchedAddresses.add(addr);
      }
    } catch (error) {
      log.warn(`[BLOCKCHAIN] Batch UTXO fetch failed, falling back to individual requests`, { error: String(error) });
      // Fallback to individual requests if batch fails
      for (const addr of batchAddresses) {
        try {
          const utxos = await client.getAddressUTXOs(addr);
          utxoResults.push({ address: addr, utxos });
          successfullyFetchedAddresses.add(addr);
        } catch (e) {
          log.warn(`[BLOCKCHAIN] Failed to get UTXOs for ${addr}`, { error: String(e) });
          // Don't add to successfullyFetchedAddresses - we don't know the true state
        }
      }
    }
  }

  // Collect all UTXO identifiers
  const allUtxoKeys = new Set<string>();
  const utxoDataMap = new Map<string, { address: string; utxo: any }>();

  for (const result of utxoResults) {
    for (const utxo of result.utxos) {
      const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
      allUtxoKeys.add(key);
      utxoDataMap.set(key, { address: result.address, utxo });
    }
  }

  // PHASE 7: UTXO Reconciliation - Make blockchain authoritative
  walletLog(walletId, 'info', 'SYNC', `Reconciling ${allUtxoKeys.size} UTXOs with database...`);
  // Get all UTXOs from DB (both spent and unspent) with their addresses
  const existingUtxos = await prisma.uTXO.findMany({
    where: { walletId },
    select: { id: true, txid: true, vout: true, spent: true, confirmations: true, blockHeight: true, address: true },
  });
  const existingUtxoMap = new Map(existingUtxos.map(u => [`${u.txid}:${u.vout}`, u]));
  const existingUtxoSet = new Set(existingUtxoMap.keys());

  // Reconcile: Mark UTXOs as spent if they no longer exist on blockchain
  // IMPORTANT: Only mark as spent if we successfully queried the address
  const utxosToMarkSpent: string[] = [];
  const utxosToUpdate: Array<{ id: string; confirmations: number; blockHeight: number | null }> = [];

  for (const [key, dbUtxo] of existingUtxoMap) {
    const blockchainUtxo = utxoDataMap.get(key);

    if (!blockchainUtxo) {
      // UTXO not found on blockchain - only mark as spent if we successfully queried the address
      // This prevents incorrectly marking UTXOs as spent when blockchain fetch fails
      if (!dbUtxo.spent && successfullyFetchedAddresses.has(dbUtxo.address)) {
        utxosToMarkSpent.push(dbUtxo.id);
      }
    } else {
      // UTXO still exists - update confirmations if changed
      const utxo = blockchainUtxo.utxo;
      const newConfirmations = utxo.height > 0 ? Math.max(0, currentHeight - utxo.height + 1) : 0;
      const newBlockHeight = utxo.height > 0 ? utxo.height : null;

      if (dbUtxo.confirmations !== newConfirmations || dbUtxo.blockHeight !== newBlockHeight) {
        utxosToUpdate.push({
          id: dbUtxo.id,
          confirmations: newConfirmations,
          blockHeight: newBlockHeight,
        });
      }
    }
  }

  // Batch mark spent UTXOs
  if (utxosToMarkSpent.length > 0) {
    await prisma.uTXO.updateMany({
      where: { id: { in: utxosToMarkSpent } },
      data: { spent: true },
    });
    walletLog(walletId, 'info', 'UTXO', `Marked ${utxosToMarkSpent.length} UTXOs as spent (no longer on blockchain)`);

    // Find and invalidate any draft transactions that were using these spent UTXOs
    // This handles RBF scenarios where a replacement tx confirms, making the original draft invalid
    const affectedLocks = await prisma.draftUtxoLock.findMany({
      where: { utxoId: { in: utxosToMarkSpent } },
      select: { draftId: true, draft: { select: { id: true, label: true, recipient: true } } },
    });

    if (affectedLocks.length > 0) {
      const uniqueDraftIds = [...new Set(affectedLocks.map(lock => lock.draftId))];
      const draftLabels = affectedLocks
        .filter(lock => lock.draft.label)
        .map(lock => lock.draft.label)
        .filter((label, idx, arr) => arr.indexOf(label) === idx);

      // Delete the invalidated drafts (UTXO locks cascade delete)
      await prisma.draftTransaction.deleteMany({
        where: { id: { in: uniqueDraftIds } },
      });

      walletLog(
        walletId,
        'info',
        'DRAFT',
        `Invalidated ${uniqueDraftIds.length} draft(s) due to spent UTXOs${draftLabels.length > 0 ? `: ${draftLabels.join(', ')}` : ''}`
      );
    }

    // Also invalidate pending mempool transactions whose inputs were spent
    // This handles RBF scenarios where a replacement tx confirms
    const spentUtxoDetails = await prisma.uTXO.findMany({
      where: { id: { in: utxosToMarkSpent } },
      select: { txid: true, vout: true },
    });

    if (spentUtxoDetails.length > 0) {
      // Find pending transactions that have inputs matching the spent UTXOs
      const pendingTxsToInvalidate = await prisma.transaction.findMany({
        where: {
          walletId,
          confirmations: 0,
          rbfStatus: 'active',
          inputs: {
            some: {
              OR: spentUtxoDetails.map(u => ({ txid: u.txid, vout: u.vout })),
            },
          },
        },
        select: { id: true, txid: true },
      });

      if (pendingTxsToInvalidate.length > 0) {
        await prisma.transaction.updateMany({
          where: { id: { in: pendingTxsToInvalidate.map(tx => tx.id) } },
          data: { rbfStatus: 'replaced' },
        });

        walletLog(
          walletId,
          'info',
          'TX',
          `Marked ${pendingTxsToInvalidate.length} pending transaction(s) as replaced (inputs spent): ${pendingTxsToInvalidate.map(tx => tx.txid.slice(0, 8)).join(', ')}`
        );
      }
    }
  }

  // Batch update UTXO confirmations
  if (utxosToUpdate.length > 0) {
    await prisma.$transaction(
      utxosToUpdate.map(u =>
        prisma.uTXO.update({
          where: { id: u.id },
          data: { confirmations: u.confirmations, blockHeight: u.blockHeight },
        })
      )
    );
    log.debug(`[BLOCKCHAIN] Updated confirmations for ${utxosToUpdate.length} UTXOs`);
  }

  // Filter to only new UTXOs (not already in DB)
  const newUtxoKeys = Array.from(allUtxoKeys).filter(key => !existingUtxoSet.has(key));
  log.debug(`[BLOCKCHAIN] Found ${newUtxoKeys.length} new UTXOs (${existingUtxoSet.size} already exist, ${utxosToMarkSpent.length} marked spent)`);

  // PHASE 8: Fetch tx details for new UTXOs (use cache when available)
  const utxosToCreate: any[] = [];

  for (const key of newUtxoKeys) {
    const data = utxoDataMap.get(key)!;
    const { address, utxo } = data;

    // Get tx details from cache or fetch
    let txDetails = txDetailsCache.get(utxo.tx_hash);
    if (!txDetails) {
      try {
        txDetails = await client.getTransaction(utxo.tx_hash);
        txDetailsCache.set(utxo.tx_hash, txDetails);
      } catch (error) {
        log.warn(`[BLOCKCHAIN] Failed to get tx ${utxo.tx_hash} for UTXO`, { error: String(error) });
        continue;
      }
    }

    const output = txDetails.vout?.[utxo.tx_pos];
    if (!output) continue;

    const confirmations = utxo.height > 0 ? Math.max(0, currentHeight - utxo.height + 1) : 0;

    utxosToCreate.push({
      walletId,
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      address,
      amount: BigInt(utxo.value),
      scriptPubKey: output.scriptPubKey?.hex || '',
      confirmations,
      blockHeight: utxo.height > 0 ? utxo.height : null,
      spent: false,
    });
  }

  // PHASE 9: Batch insert UTXOs
  let totalUtxos = 0;
  if (utxosToCreate.length > 0) {
    log.debug(`[BLOCKCHAIN] Inserting ${utxosToCreate.length} UTXOs...`);
    await prisma.uTXO.createMany({
      data: utxosToCreate,
      skipDuplicates: true,
    });
    totalUtxos = utxosToCreate.length;

    // Calculate total value of new UTXOs
    const totalValue = utxosToCreate.reduce((sum, u) => sum + Number(u.amount), 0);
    walletLog(walletId, 'info', 'UTXO', `Found ${totalUtxos} new UTXOs (${(totalValue / 100000000).toFixed(8)} BTC)`);
  }

  // PHASE 10: Batch update used addresses
  walletLog(walletId, 'debug', 'SYNC', 'Phase 10: Updating address states...');
  const usedAddresses = new Set<string>();
  for (const [addressStr, history] of historyResults) {
    if (history.length > 0) {
      usedAddresses.add(addressStr);
    }
  }

  if (usedAddresses.size > 0) {
    await prisma.address.updateMany({
      where: {
        walletId,
        address: { in: Array.from(usedAddresses) },
        used: false,
      },
      data: { used: true },
    });
  }

  // PHASE 11: Gap limit expansion
  // After marking addresses as used, check if we need to generate more addresses
  // to maintain the BIP-44 gap limit (20 consecutive unused addresses)
  walletLog(walletId, 'debug', 'SYNC', 'Phase 11: Checking address gap limit...');
  const newAddresses = await ensureGapLimit(walletId);

  // If new addresses were generated, scan them for transactions
  // This handles the case where external software used addresses beyond our current range
  let additionalTxCount = 0;
  let additionalUtxoCount = 0;

  if (newAddresses.length > 0) {
    walletLog(walletId, 'info', 'BLOCKCHAIN', `Scanning ${newAddresses.length} newly generated addresses`);

    // Fetch history for new addresses
    const newAddressStrings = newAddresses.map(a => a.address);

    try {
      const newHistoryResults = await client.getAddressHistoryBatch(newAddressStrings);

      // Check if any new addresses have transactions
      let foundTransactions = false;
      for (const [, history] of newHistoryResults) {
        if (history.length > 0) {
          foundTransactions = true;
          break;
        }
      }

      if (foundTransactions) {
        // Recursively sync the wallet to process new transactions
        // This will also trigger another gap limit check if needed
        walletLog(walletId, 'info', 'BLOCKCHAIN', 'Found transactions on new addresses, re-syncing...');
        const recursiveResult = await syncWallet(walletId);
        additionalTxCount = recursiveResult.transactions;
        additionalUtxoCount = recursiveResult.utxos;
      }
    } catch (error) {
      log.warn(`[BLOCKCHAIN] Failed to scan new addresses: ${error}`);
    }
  }

  const elapsed = Date.now() - startTime;
  const finalTxCount = totalTransactions + additionalTxCount;
  const finalUtxoCount = totalUtxos + additionalUtxoCount;
  log.debug(`[BLOCKCHAIN] Wallet sync completed in ${elapsed}ms: ${finalTxCount} tx, ${finalUtxoCount} utxos`);

  walletLog(walletId, 'info', 'SYNC', `Sync completed in ${(elapsed / 1000).toFixed(1)}s`, {
    addresses: addresses.length + newAddresses.length,
    transactions: finalTxCount,
    utxos: finalUtxoCount,
    viaTor,
  });

  return {
    addresses: addresses.length + newAddresses.length,
    transactions: finalTxCount,
    utxos: finalUtxoCount,
  };
}

/**
 * Calculate confirmations for a transaction (internal helper)
 */
async function getConfirmations(blockHeight: number): Promise<number> {
  if (blockHeight <= 0) return 0;

  try {
    const currentHeight = await getBlockHeight();
    return Math.max(0, currentHeight - blockHeight + 1);
  } catch (error) {
    log.error('[BLOCKCHAIN] Failed to get confirmations', { error: String(error) });
    return 0;
  }
}

/**
 * Broadcast a transaction to the network
 */
export async function broadcastTransaction(rawTx: string): Promise<{
  txid: string;
  broadcasted: boolean;
}> {
  const client = await getNodeClient();


  try {
    const txid = await client.broadcastTransaction(rawTx);
    return {
      txid,
      broadcasted: true,
    };
  } catch (error: any) {
    throw new Error(`Failed to broadcast transaction: ${error.message}`);
  }
}

/**
 * Get fee estimates for different confirmation targets
 */
export async function getFeeEstimates(): Promise<{
  fastest: number;   // ~1 block
  halfHour: number;  // ~3 blocks
  hour: number;      // ~6 blocks
  economy: number;   // ~12 blocks
}> {
  const client = await getNodeClient();


  try {
    const [fastest, halfHour, hour, economy] = await Promise.all([
      client.estimateFee(1),
      client.estimateFee(3),
      client.estimateFee(6),
      client.estimateFee(12),
    ]);

    return {
      fastest: Math.max(1, fastest),
      halfHour: Math.max(1, halfHour),
      hour: Math.max(1, hour),
      economy: Math.max(1, economy),
    };
  } catch (error) {
    log.error('[BLOCKCHAIN] Failed to get fee estimates', { error: String(error) });
    // Return sensible defaults if fee estimation fails
    return {
      fastest: 20,
      halfHour: 15,
      hour: 10,
      economy: 5,
    };
  }
}

/**
 * Get transaction details from blockchain
 */
export async function getTransactionDetails(txid: string): Promise<any> {
  const client = await getNodeClient();


  return client.getTransaction(txid, true);
}

/**
 * Monitor address for new transactions
 * Subscribe to address and get notifications
 */
export async function monitorAddress(address: string): Promise<string | null> {
  const client = await getNodeClient();


  return client.subscribeAddress(address);
}

/**
 * Validate and check if address is used
 */
export async function checkAddress(
  address: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): Promise<{
  valid: boolean;
  error?: string;
  balance?: number;
  transactionCount?: number;
}> {
  // First validate format
  const validation = validateAddress(address, network);
  if (!validation.valid) {
    return validation;
  }

  // Check blockchain
  const client = await getNodeClient();

  try {
    if (!client.isConnected()) {
      await client.connect();
    }

    const [balance, history] = await Promise.all([
      client.getAddressBalance(address),
      client.getAddressHistory(address),
    ]);

    return {
      valid: true,
      balance: balance.confirmed + balance.unconfirmed,
      transactionCount: history.length,
    };
  } catch (error) {
    return {
      valid: true, // Address format is valid even if we can't check blockchain
      error: 'Could not check address on blockchain',
    };
  }
}
