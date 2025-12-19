/**
 * Blockchain Service
 *
 * High-level service for interacting with the Bitcoin blockchain.
 * Handles address monitoring, transaction fetching, and UTXO management.
 */

import { getNodeClient } from './nodeClient';
import prisma from '../../models/prisma';
import { validateAddress, parseTransaction } from './utils';
import { createLogger } from '../../utils/logger';
import { walletLog } from '../../websocket/notifications';
import { DEFAULT_DEEP_CONFIRMATION_THRESHOLD, ADDRESS_GAP_LIMIT } from '../../constants';
import * as addressDerivation from './addressDerivation';

const log = createLogger('BLOCKCHAIN');

/**
 * Recalculate balanceAfter for all transactions in a wallet
 * Called after new transactions are inserted to ensure running balances are accurate
 */
export async function recalculateWalletBalances(walletId: string): Promise<void> {
  // Get all transactions sorted by block time (oldest first)
  const transactions = await prisma.transaction.findMany({
    where: { walletId },
    orderBy: [
      { blockTime: 'asc' },
      { createdAt: 'asc' },
    ],
    select: { id: true, amount: true },
  });

  // Calculate running balance and update each transaction
  let runningBalance = BigInt(0);
  for (const tx of transactions) {
    runningBalance += tx.amount;
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { balanceAfter: runningBalance },
    });
  }

  log.debug(`[BLOCKCHAIN] Recalculated balances for ${transactions.length} transactions in wallet ${walletId}`);
}

/**
 * Check and expand addresses to maintain gap limit
 *
 * BIP-44 specifies a "gap limit" of 20 - the wallet should stop looking for
 * addresses after finding 20 consecutive unused addresses. Conversely, we need
 * to ensure there are always at least 20 unused addresses at the end of both
 * the receive and change chains.
 *
 * @returns Array of newly generated addresses that should be scanned
 */
export async function ensureGapLimit(walletId: string): Promise<Array<{ address: string; derivationPath: string }>> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, descriptor: true, network: true },
  });

  if (!wallet?.descriptor) {
    log.debug(`[BLOCKCHAIN] Wallet ${walletId} has no descriptor, skipping gap limit check`);
    return [];
  }

  // Get all addresses with their used status
  const addresses = await prisma.address.findMany({
    where: { walletId },
    select: { derivationPath: true, index: true, used: true },
    orderBy: { index: 'asc' },
  });

  // Separate into receive (/0/) and change (/1/) addresses
  const receiveAddrs = addresses.filter(a => a.derivationPath?.includes('/0/'));
  const changeAddrs = addresses.filter(a => a.derivationPath?.includes('/1/'));

  const newAddresses: Array<{ address: string; derivationPath: string }> = [];

  // Check receive addresses gap limit
  const receiveGap = countUnusedGap(receiveAddrs);
  if (receiveGap < ADDRESS_GAP_LIMIT) {
    const maxReceiveIndex = Math.max(-1, ...receiveAddrs.map(a => a.index));
    const toGenerate = ADDRESS_GAP_LIMIT - receiveGap;

    walletLog(walletId, 'info', 'ADDRESS', `Expanding receive addresses (gap: ${receiveGap}/${ADDRESS_GAP_LIMIT})`, {
      currentMax: maxReceiveIndex,
      generating: toGenerate,
    });

    for (let i = maxReceiveIndex + 1; i <= maxReceiveIndex + toGenerate; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          { network: wallet.network as 'mainnet' | 'testnet' | 'regtest', change: false }
        );
        newAddresses.push({ address, derivationPath });
      } catch (err) {
        log.error(`Failed to derive receive address ${i}`, { error: err });
      }
    }
  }

  // Check change addresses gap limit
  const changeGap = countUnusedGap(changeAddrs);
  if (changeGap < ADDRESS_GAP_LIMIT) {
    const maxChangeIndex = Math.max(-1, ...changeAddrs.map(a => a.index));
    const toGenerate = ADDRESS_GAP_LIMIT - changeGap;

    walletLog(walletId, 'info', 'ADDRESS', `Expanding change addresses (gap: ${changeGap}/${ADDRESS_GAP_LIMIT})`, {
      currentMax: maxChangeIndex,
      generating: toGenerate,
    });

    for (let i = maxChangeIndex + 1; i <= maxChangeIndex + toGenerate; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          { network: wallet.network as 'mainnet' | 'testnet' | 'regtest', change: true }
        );
        newAddresses.push({ address, derivationPath });
      } catch (err) {
        log.error(`Failed to derive change address ${i}`, { error: err });
      }
    }
  }

  // Bulk insert new addresses
  if (newAddresses.length > 0) {
    const addressesToCreate = newAddresses.map(a => ({
      walletId,
      address: a.address,
      derivationPath: a.derivationPath,
      index: parseInt(a.derivationPath.split('/').pop() || '0', 10),
      used: false,
    }));

    await prisma.address.createMany({
      data: addressesToCreate,
      skipDuplicates: true,
    });

    walletLog(walletId, 'info', 'ADDRESS', `Generated ${newAddresses.length} new addresses to maintain gap limit`);
  }

  return newAddresses;
}

/**
 * Count consecutive unused addresses at the end of an address list
 */
function countUnusedGap(addresses: Array<{ index: number; used: boolean }>): number {
  if (addresses.length === 0) return 0;

  // Sort by index descending to count from the end
  const sorted = [...addresses].sort((a, b) => b.index - a.index);

  let gap = 0;
  for (const addr of sorted) {
    if (!addr.used) {
      gap++;
    } else {
      break; // Stop counting when we hit a used address
    }
  }

  return gap;
}

// Cache for block timestamps to avoid repeated lookups
const blockTimestampCache = new Map<number, Date>();

/**
 * Get block timestamp from block height
 * Block header is 80 bytes hex; timestamp is at bytes 68-72 (little-endian uint32)
 */
async function getBlockTimestamp(height: number): Promise<Date | null> {
  if (height <= 0) return null;

  // Check cache first
  if (blockTimestampCache.has(height)) {
    return blockTimestampCache.get(height)!;
  }

  try {
    const client = await getNodeClient();
    const headerHex = await client.getBlockHeader(height);

    // Block header structure (80 bytes):
    // - version: 4 bytes (0-3)
    // - prev_block_hash: 32 bytes (4-35)
    // - merkle_root: 32 bytes (36-67)
    // - timestamp: 4 bytes (68-71) - little-endian uint32
    // - bits: 4 bytes (72-75)
    // - nonce: 4 bytes (76-79)

    // Extract timestamp bytes (68-71, each byte is 2 hex chars)
    const timestampHex = headerHex.slice(136, 144); // bytes 68-71 = chars 136-143

    // Convert from little-endian hex to number
    const timestampBuffer = Buffer.from(timestampHex, 'hex');
    const timestamp = timestampBuffer.readUInt32LE(0);

    const date = new Date(timestamp * 1000);
    blockTimestampCache.set(height, date);
    return date;
  } catch (error) {
    log.warn(`[BLOCKCHAIN] Failed to get timestamp for block ${height}`, { error: String(error) });
    return null;
  }
}

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
  walletLog(walletId, 'info', 'SYNC', 'Starting wallet sync...');
  const client = await getNodeClient();


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

  // PHASE 1: Batch fetch all address histories using true RPC batching
  walletLog(walletId, 'debug', 'SYNC', 'Phase 1: Fetching address histories...');
  log.debug(`[BLOCKCHAIN] Fetching history for ${addresses.length} addresses using batch RPC...`);
  const BATCH_SIZE = 50; // Number of addresses per batch RPC call
  const historyResults: Map<string, Array<{ tx_hash: string; height: number }>> = new Map();

  // Process addresses in batches for true RPC batching
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batchAddresses = addresses.slice(i, i + BATCH_SIZE).map(a => a.address);
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

  walletLog(walletId, 'debug', 'BLOCKCHAIN', `Found ${addressesWithActivity} addresses with activity`, {
    totalTransactions: allTxids.size,
  });

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

  // PHASE 3: Batch fetch transaction details for new txids using true RPC batching
  walletLog(walletId, 'debug', 'SYNC', `Phase 3: Fetching ${newTxids.length} transaction details...`);
  const txDetailsCache: Map<string, any> = new Map();
  const TX_BATCH_SIZE = 25; // Number of transactions per batch RPC call

  for (let i = 0; i < newTxids.length; i += TX_BATCH_SIZE) {
    const batchTxids = newTxids.slice(i, i + TX_BATCH_SIZE);
    try {
      const batchResults = await client.getTransactionsBatch(batchTxids, true);
      // Merge results into cache
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
  }

  // PHASE 4: Process transactions and collect records to insert
  walletLog(walletId, 'debug', 'SYNC', 'Phase 4: Processing transactions...');
  const transactionsToCreate: any[] = [];
  const currentHeight = await getBlockHeight();

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

  // Process each address's history
  for (const [addressStr, history] of historyResults) {
    const addressRecord = addressMap.get(addressStr)!;

    for (const item of history) {
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
        const amount = outputs
          .filter((out: any) => outputMatchesAddress(out, addressStr))
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

  // PHASE 5: Batch insert transactions
  let totalTransactions = 0;
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
    log.debug(`[BLOCKCHAIN] Inserting ${uniqueTxArray.length} transactions...`);

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

    // Use createMany for bulk insert (note: doesn't return created records)
    await prisma.transaction.createMany({
      data: uniqueTxArray,
      skipDuplicates: true,
    });
    totalTransactions = newTransactions.length;

    // Recalculate running balances for all transactions in this wallet
    if (newTransactions.length > 0) {
      await recalculateWalletBalances(walletId);
    }

    // Log transaction type breakdown (only new ones)
    const received = newTransactions.filter(t => t.type === 'received').length;
    const sent = newTransactions.filter(t => t.type === 'sent').length;
    const consolidation = newTransactions.filter(t => t.type === 'consolidation').length;
    walletLog(walletId, 'info', 'BLOCKCHAIN', `Recorded ${totalTransactions} new transactions`, {
      received,
      sent,
      consolidation,
    });

    // Only send notifications for NEW transactions (not already in database)
    if (newTransactions.length > 0) {
      // Send notifications for new transactions (Telegram + Push, async, don't block sync)
      const { notifyNewTransactions } = await import('../notifications/notificationService');
      notifyNewTransactions(walletId, newTransactions.map(tx => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
      }))).catch(err => {
        log.warn(`[BLOCKCHAIN] Failed to send notifications: ${err}`);
      });

      // Broadcast WebSocket events for real-time frontend notifications and sounds
      const { getNotificationService } = await import('../../websocket/notifications');
      const notificationService = getNotificationService();
      for (const tx of newTransactions) {
        notificationService.broadcastTransactionNotification({
          txid: tx.txid,
          walletId,
          type: tx.type === 'received' ? 'received' : 'sent',
          amount: Number(tx.amount),
          confirmations: tx.confirmations || 0,
          blockHeight: tx.blockHeight ?? undefined,
          timestamp: tx.blockTime || new Date(),
        });
      }
    }

    // PHASE 5.5: Auto-apply address labels to new transactions
    // When an address has labels, new transactions at that address inherit them
    try {
      // Get unique addressIds from created transactions
      const addressIds = [...new Set(uniqueTxArray.map(tx => tx.addressId).filter(Boolean))] as string[];

      if (addressIds.length > 0) {
        // Fetch address labels for these addresses
        const addressLabels = await prisma.addressLabel.findMany({
          where: { addressId: { in: addressIds } },
        });

        if (addressLabels.length > 0) {
          // Group labels by addressId
          const labelsByAddress = new Map<string, string[]>();
          for (const al of addressLabels) {
            const labels = labelsByAddress.get(al.addressId) || [];
            labels.push(al.labelId);
            labelsByAddress.set(al.addressId, labels);
          }

          // Query the created transactions to get their IDs
          const createdTxs = await prisma.transaction.findMany({
            where: {
              walletId,
              txid: { in: uniqueTxArray.map(tx => tx.txid) },
            },
            select: { id: true, txid: true, addressId: true },
          });

          // Build TransactionLabel records
          const txLabelData: { transactionId: string; labelId: string }[] = [];
          for (const tx of createdTxs) {
            if (tx.addressId) {
              const labels = labelsByAddress.get(tx.addressId) || [];
              for (const labelId of labels) {
                txLabelData.push({ transactionId: tx.id, labelId });
              }
            }
          }

          // Batch insert transaction labels
          if (txLabelData.length > 0) {
            await prisma.transactionLabel.createMany({
              data: txLabelData,
              skipDuplicates: true,
            });
            log.debug(`[BLOCKCHAIN] Auto-applied ${txLabelData.length} labels to transactions from address labels`);
          }
        }
      }
    } catch (labelError) {
      // Don't fail the sync if labeling fails
      log.warn(`[BLOCKCHAIN] Failed to auto-apply address labels: ${labelError}`);
    }
  }

  // PHASE 6: Batch fetch all UTXOs for all addresses using true RPC batching
  walletLog(walletId, 'debug', 'SYNC', 'Phase 6: Fetching UTXOs...');
  log.debug(`[BLOCKCHAIN] Fetching UTXOs for ${addresses.length} addresses using batch RPC...`);
  const utxoResults: Array<{ address: string; utxos: any[] }> = [];

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batchAddresses = addresses.slice(i, i + BATCH_SIZE).map(a => a.address);
    try {
      const batchResults = await client.getAddressUTXOsBatch(batchAddresses);
      // Convert Map to array format
      for (const [addr, utxos] of batchResults) {
        utxoResults.push({ address: addr, utxos });
      }
    } catch (error) {
      log.warn(`[BLOCKCHAIN] Batch UTXO fetch failed, falling back to individual requests`, { error: String(error) });
      // Fallback to individual requests if batch fails
      for (const addr of batchAddresses) {
        try {
          const utxos = await client.getAddressUTXOs(addr);
          utxoResults.push({ address: addr, utxos });
        } catch (e) {
          log.warn(`[BLOCKCHAIN] Failed to get UTXOs for ${addr}`, { error: String(e) });
          utxoResults.push({ address: addr, utxos: [] });
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
  walletLog(walletId, 'debug', 'SYNC', `Phase 7: Reconciling ${allUtxoKeys.size} UTXOs with database...`);
  // Get all UTXOs from DB (both spent and unspent)
  const existingUtxos = await prisma.uTXO.findMany({
    where: { walletId },
    select: { id: true, txid: true, vout: true, spent: true, confirmations: true, blockHeight: true },
  });
  const existingUtxoMap = new Map(existingUtxos.map(u => [`${u.txid}:${u.vout}`, u]));
  const existingUtxoSet = new Set(existingUtxoMap.keys());

  // Reconcile: Mark UTXOs as spent if they no longer exist on blockchain
  const utxosToMarkSpent: string[] = [];
  const utxosToUpdate: Array<{ id: string; confirmations: number; blockHeight: number | null }> = [];

  for (const [key, dbUtxo] of existingUtxoMap) {
    const blockchainUtxo = utxoDataMap.get(key);

    if (!blockchainUtxo) {
      // UTXO not on blockchain anymore - mark as spent
      if (!dbUtxo.spent) {
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
    walletLog(walletId, 'info', 'UTXO', `Found ${totalUtxos} new UTXOs`, {
      totalSats: totalValue,
      existing: existingUtxoSet.size,
    });
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
  });

  return {
    addresses: addresses.length + newAddresses.length,
    transactions: finalTxCount,
    utxos: finalUtxoCount,
  };
}

/**
 * Get current block height
 */
export async function getBlockHeight(): Promise<number> {
  const client = await getNodeClient();


  return client.getBlockHeight();
}

/**
 * Calculate confirmations for a transaction
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

/**
 * Confirmation update result with milestone tracking
 */
export interface ConfirmationUpdate {
  txid: string;
  oldConfirmations: number;
  newConfirmations: number;
}

/**
 * Update confirmations for pending transactions - OPTIMIZED with batch updates
 * Returns detailed info about which transactions changed, for milestone notifications
 */
export async function updateTransactionConfirmations(walletId: string): Promise<ConfirmationUpdate[]> {
  // Get deep confirmation threshold from settings
  const deepThresholdSetting = await prisma.systemSetting.findUnique({
    where: { key: 'deepConfirmationThreshold' },
  });
  const deepConfirmationThreshold = deepThresholdSetting
    ? JSON.parse(deepThresholdSetting.value)
    : DEFAULT_DEEP_CONFIRMATION_THRESHOLD;

  const transactions = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: deepConfirmationThreshold }, // Only update transactions below deep confirmation threshold
      blockHeight: { not: null },
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });

  if (transactions.length === 0) return [];

  const currentHeight = await getBlockHeight();

  // Calculate new confirmations and collect updates
  const updates: Array<{ id: string; txid: string; oldConfirmations: number; newConfirmations: number }> = [];

  for (const tx of transactions) {
    if (tx.blockHeight) {
      const newConfirmations = Math.max(0, currentHeight - tx.blockHeight + 1);
      if (newConfirmations !== tx.confirmations) {
        updates.push({
          id: tx.id,
          txid: tx.txid,
          oldConfirmations: tx.confirmations,
          newConfirmations,
        });
      }
    }
  }

  // Batch update using a transaction
  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(u =>
        prisma.transaction.update({
          where: { id: u.id },
          data: { confirmations: u.newConfirmations },
        })
      )
    );
  }

  return updates.map(u => ({
    txid: u.txid,
    oldConfirmations: u.oldConfirmations,
    newConfirmations: u.newConfirmations,
  }));
}

/**
 * Result from populating missing transaction fields
 */
export interface PopulateFieldsResult {
  updated: number;
  confirmationUpdates: ConfirmationUpdate[];
}

/**
 * Populate missing transaction fields (blockHeight, addressId, blockTime, fee) from blockchain
 * Called during sync to fill in data for transactions that were created before
 * these fields existed or were populated
 * OPTIMIZED with batch fetching and batch updates
 * Returns both count and confirmation updates for notification broadcasting
 */
export async function populateMissingTransactionFields(walletId: string): Promise<PopulateFieldsResult> {
  const client = await getNodeClient();


  // Find transactions with missing fields (including fee and counterparty address)
  const transactions = await prisma.transaction.findMany({
    where: {
      walletId,
      OR: [
        { blockHeight: null },
        { addressId: null },
        { blockTime: null },
        { fee: null },
        { counterpartyAddress: null },
      ],
    },
    include: {
      wallet: {
        include: {
          addresses: true,
        },
      },
    },
  });

  if (transactions.length === 0) {
    return { updated: 0, confirmationUpdates: [] };
  }

  log.debug(`[BLOCKCHAIN] Populating missing fields for ${transactions.length} transactions in wallet ${walletId}`);

  const currentHeight = await getBlockHeight();

  // PHASE 0: Get block heights from address history (more reliable than verbose tx for some servers)
  // This handles servers like Blockstream that don't support verbose transaction responses
  const txHeightFromHistory = new Map<string, number>();
  const addressesForHistory = new Set<string>();

  // Collect addresses that have transactions with missing blockHeight
  for (const tx of transactions) {
    if (tx.blockHeight === null && tx.wallet.addresses) {
      for (const addr of tx.wallet.addresses) {
        addressesForHistory.add(addr.address);
      }
    }
  }

  // Fetch address histories to get transaction heights
  const HISTORY_BATCH_SIZE = 10;
  const addressList = Array.from(addressesForHistory);
  for (let i = 0; i < addressList.length; i += HISTORY_BATCH_SIZE) {
    const batch = addressList.slice(i, i + HISTORY_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (address) => {
        try {
          const history = await client.getAddressHistory(address);
          return history;
        } catch (error) {
          return [];
        }
      })
    );
    for (const history of results) {
      for (const item of history) {
        if (item.height > 0) {
          txHeightFromHistory.set(item.tx_hash, item.height);
        }
      }
    }
  }

  // PHASE 1: Batch fetch all transaction details in parallel
  const TX_BATCH_SIZE = 5;
  const txDetailsCache = new Map<string, any>();
  const txids = transactions.map(tx => tx.txid);

  for (let i = 0; i < txids.length; i += TX_BATCH_SIZE) {
    const batch = txids.slice(i, i + TX_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (txid) => {
        try {
          const details = await client.getTransaction(txid, true);
          return { txid, details };
        } catch (error) {
          log.warn(`[BLOCKCHAIN] Failed to fetch tx ${txid}`, { error: String(error) });
          return { txid, details: null };
        }
      })
    );
    for (const result of results) {
      if (result.details) {
        txDetailsCache.set(result.txid, result.details);
      }
    }
  }

  // Collect all pending updates
  const pendingUpdates: Array<{ id: string; txid: string; oldConfirmations: number; data: any }> = [];
  let updated = 0;

  for (const tx of transactions) {
    try {
      // Get transaction details from cache (may be null if verbose not supported)
      const txDetails = txDetailsCache.get(tx.txid);
      const oldConfirmations = tx.confirmations;

      const updates: any = {};

      // Populate blockHeight if missing
      // Handle Electrum (blockheight), Bitcoin Core RPC (confirmations), or address history
      if (tx.blockHeight === null) {
        if (txDetails?.blockheight) {
          // Electrum provides blockheight directly
          updates.blockHeight = txDetails.blockheight;
          updates.confirmations = Math.max(0, currentHeight - txDetails.blockheight + 1);
        } else if (txDetails?.confirmations && txDetails.confirmations > 0) {
          // Bitcoin Core RPC provides confirmations, calculate blockHeight
          const calculatedBlockHeight = currentHeight - txDetails.confirmations + 1;
          updates.blockHeight = calculatedBlockHeight;
          updates.confirmations = txDetails.confirmations;
        } else if (txHeightFromHistory.has(tx.txid)) {
          // Fallback: get height from address history (for servers like Blockstream that don't support verbose)
          const heightFromHistory = txHeightFromHistory.get(tx.txid)!;
          updates.blockHeight = heightFromHistory;
          updates.confirmations = Math.max(0, currentHeight - heightFromHistory + 1);
          log.debug(`[BLOCKCHAIN] Got blockHeight ${heightFromHistory} from address history for tx ${tx.txid}`);
        }
      }

      // Skip remaining field population if we don't have transaction details
      if (!txDetails) {
        // Still save blockHeight update if we got it from address history
        if (Object.keys(updates).length > 0) {
          pendingUpdates.push({ id: tx.id, txid: tx.txid, oldConfirmations, data: updates });
          updated++;
        }
        continue;
      }

      // Populate blockTime if missing
      if (tx.blockTime === null) {
        if (txDetails.time) {
          updates.blockTime = new Date(txDetails.time * 1000);
        } else if (tx.blockHeight || updates.blockHeight) {
          // Derive timestamp from block header if tx.time not available
          const height = updates.blockHeight || tx.blockHeight;
          const blockTime = await getBlockTimestamp(height);
          if (blockTime) {
            updates.blockTime = blockTime;
          }
        }
      }

      const inputs = txDetails.vin || [];
      const outputs = txDetails.vout || [];
      const isSentTx = tx.type === 'sent' || tx.type === 'send';
      const isConsolidationTx = tx.type === 'consolidation';
      const isReceivedTx = tx.type === 'received' || tx.type === 'receive';

      // Populate fee if missing - for sent and consolidation transactions (receiver doesn't pay fees)
      if (tx.fee === null && (isSentTx || isConsolidationTx)) {
        try {
          // Some Electrum servers provide fee directly
          if (txDetails.fee != null) {
            // Fee is in BTC, convert to sats
            updates.fee = BigInt(Math.round(txDetails.fee * 100000000));
          } else {
            // Calculate fee from inputs - outputs
            let totalInputValue = 0;
            let totalOutputValue = 0;

            // Calculate total output value
            for (const output of outputs) {
              if (output.value != null) {
                totalOutputValue += Math.round(output.value * 100000000);
              }
            }

            // Calculate total input value (need to look up previous outputs)
            for (const input of inputs) {
              // Skip coinbase transactions
              if (input.coinbase) {
                totalInputValue = totalOutputValue; // Coinbase has no fee from user perspective
                break;
              }

              // If prevout info is included (verbose mode)
              if (input.prevout && input.prevout.value != null) {
                totalInputValue += Math.round(input.prevout.value * 100000000);
              } else if (input.txid && input.vout != null) {
                // Need to fetch the previous transaction to get the value
                try {
                  const prevTx = await client.getTransaction(input.txid, true);
                  if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                    totalInputValue += Math.round(prevTx.vout[input.vout].value * 100000000);
                  }
                } catch (e) {
                  log.warn(`[BLOCKCHAIN] Could not fetch input tx ${input.txid}`, { error: String(e) });
                }
              }
            }

            // Only set fee if we successfully calculated inputs
            if (totalInputValue > 0 && totalInputValue >= totalOutputValue) {
              const fee = totalInputValue - totalOutputValue;
              if (fee > 0 && fee < 100000000) { // Sanity check: fee should be less than 1 BTC
                updates.fee = BigInt(fee);
              }
            }
          }
        } catch (feeError) {
          log.warn(`[BLOCKCHAIN] Could not calculate fee for tx ${tx.txid}`, { error: String(feeError) });
        }
      }

      // Populate counterparty address if missing
      if (tx.counterpartyAddress === null) {
        try {
          if (isReceivedTx) {
            // For received transactions, get the sender address from inputs
            for (const input of inputs) {
              // Skip coinbase transactions
              if (input.coinbase) break;

              // Try to get address from prevout (verbose mode)
              if (input.prevout && input.prevout.scriptPubKey) {
                const senderAddr = input.prevout.scriptPubKey.address ||
                  (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
                if (senderAddr) {
                  updates.counterpartyAddress = senderAddr;
                  break;
                }
              } else if (input.txid && input.vout != null) {
                // Fetch the previous transaction to get sender address
                try {
                  const prevTx = await client.getTransaction(input.txid, true);
                  if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                    const prevOutput = prevTx.vout[input.vout];
                    const senderAddr = prevOutput.scriptPubKey?.address ||
                      (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
                    if (senderAddr) {
                      updates.counterpartyAddress = senderAddr;
                      break;
                    }
                  }
                } catch (e) {
                  log.warn(`[BLOCKCHAIN] Could not fetch input tx for sender address`, { error: String(e) });
                }
              }
            }
          } else if (isSentTx) {
            // For sent transactions, get the recipient address from outputs
            // Skip change outputs (outputs that go back to our wallet)
            const walletAddressStrings = tx.wallet.addresses.map(a => a.address);
            for (const output of outputs) {
              const outputAddr = output.scriptPubKey?.address ||
                (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);
              // Skip if it's our own address (change output)
              if (outputAddr && !walletAddressStrings.includes(outputAddr)) {
                updates.counterpartyAddress = outputAddr;
                break;
              }
            }
          }
        } catch (counterpartyError) {
          log.warn(`[BLOCKCHAIN] Could not get counterparty address for tx ${tx.txid}`, { error: String(counterpartyError) });
        }
      }

      // Populate addressId if missing - find which wallet address was involved
      const walletAddressStrings = tx.wallet.addresses.map(a => a.address);

      if (tx.addressId === null && tx.wallet.addresses.length > 0) {
        // Check outputs for receive transactions
        if (tx.type === 'received' || tx.type === 'receive') {
          const outputs = txDetails.vout || [];
          for (const output of outputs) {
            const outputAddresses = output.scriptPubKey?.addresses || [];
            // Also check for address field directly (newer Electrum format)
            if (output.scriptPubKey?.address) {
              outputAddresses.push(output.scriptPubKey.address);
            }

            for (const addr of outputAddresses) {
              if (walletAddressStrings.includes(addr)) {
                const matchingAddress = tx.wallet.addresses.find(a => a.address === addr);
                if (matchingAddress) {
                  updates.addressId = matchingAddress.id;
                  break;
                }
              }
            }
            if (updates.addressId) break;
          }
        }

        // Check inputs for send transactions
        if (tx.type === 'sent' || tx.type === 'send') {
          const inputs = txDetails.vin || [];
          for (const input of inputs) {
            if (input.prevout && input.prevout.scriptPubKey) {
              const inputAddress = input.prevout.scriptPubKey.address ||
                (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);

              if (inputAddress && walletAddressStrings.includes(inputAddress)) {
                const matchingAddress = tx.wallet.addresses.find(a => a.address === inputAddress);
                if (matchingAddress) {
                  updates.addressId = matchingAddress.id;
                  break;
                }
              }
            }
          }
        }
      }

      // Collect updates if any
      if (Object.keys(updates).length > 0) {
        pendingUpdates.push({ id: tx.id, txid: tx.txid, oldConfirmations, data: updates });
      }
    } catch (error) {
      log.warn(`[BLOCKCHAIN] Failed to populate fields for tx ${tx.txid}`, { error: String(error) });
    }
  }

  // PHASE 2: Batch apply all updates
  if (pendingUpdates.length > 0) {
    log.debug(`[BLOCKCHAIN] Applying ${pendingUpdates.length} transaction updates...`);
    await prisma.$transaction(
      pendingUpdates.map(u =>
        prisma.transaction.update({
          where: { id: u.id },
          data: u.data,
        })
      )
    );
    updated = pendingUpdates.length;
  }

  // Extract confirmation updates for notification broadcasting
  // Only include updates where confirmations actually changed
  const confirmationUpdates: ConfirmationUpdate[] = pendingUpdates
    .filter(u => u.data.confirmations !== undefined && u.data.confirmations !== u.oldConfirmations)
    .map(u => ({
      txid: u.txid,
      oldConfirmations: u.oldConfirmations,
      newConfirmations: u.data.confirmations,
    }));

  log.debug(`[BLOCKCHAIN] Populated missing fields for ${updated} transactions, ${confirmationUpdates.length} confirmation updates`);
  return { updated, confirmationUpdates };
}
