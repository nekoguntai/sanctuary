/**
 * Transaction Confirmations Management
 *
 * Handles updating transaction confirmations and populating missing
 * transaction fields from the blockchain.
 */

import prisma from '../../../models/prisma';
import { createLogger } from '../../../utils/logger';
import { DEFAULT_DEEP_CONFIRMATION_THRESHOLD } from '../../../constants';
import { getNodeClient } from '../nodeClient';
import { getBlockHeight, getBlockTimestamp } from '../utils/blockHeight';
import { walletLog } from '../../../websocket/notifications';
import { recalculateWalletBalances } from '../utils/balanceCalculation';
import { getConfig } from '../../../config';
import { safeJsonParse, SystemSettingSchemas } from '../../../utils/safeJson';

const log = createLogger('CONFIRMATIONS');

/**
 * Execute database updates in chunks to avoid long-running transactions
 * that can cause lock contention. Uses the configured batch size.
 */
async function executeInChunks<T>(
  items: T[],
  createUpdate: (item: T) => ReturnType<typeof prisma.transaction.update>,
  walletId?: string
): Promise<void> {
  const config = getConfig();
  const batchSize = config.sync.transactionBatchSize;

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkNum = Math.floor(i / batchSize) + 1;
    const totalChunks = Math.ceil(items.length / batchSize);

    if (walletId && totalChunks > 1) {
      walletLog(walletId, 'debug', 'DB', `Processing batch ${chunkNum}/${totalChunks} (${chunk.length} updates)`);
    }

    await prisma.$transaction(chunk.map(createUpdate));
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
 * Result from populating missing transaction fields
 */
export interface PopulateFieldsResult {
  updated: number;
  confirmationUpdates: ConfirmationUpdate[];
}

/**
 * Update confirmations for pending transactions - OPTIMIZED with batch updates
 * Returns detailed info about which transactions changed, for milestone notifications
 */
export async function updateTransactionConfirmations(walletId: string): Promise<ConfirmationUpdate[]> {
  // Get wallet to determine network for correct block height
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { network: true },
  });
  if (!wallet) return [];

  const network = (wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';

  // Get deep confirmation threshold from settings
  const deepThresholdSetting = await prisma.systemSetting.findUnique({
    where: { key: 'deepConfirmationThreshold' },
  });
  const deepConfirmationThreshold = safeJsonParse(
    deepThresholdSetting?.value,
    SystemSettingSchemas.number,
    DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
    'deepConfirmationThreshold'
  );

  const transactions = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: deepConfirmationThreshold }, // Only update transactions below deep confirmation threshold
      blockHeight: { not: null },
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });

  if (transactions.length === 0) return [];

  const currentHeight = await getBlockHeight(network);

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

  // Batch update using chunked transactions to avoid long locks
  if (updates.length > 0) {
    await executeInChunks(updates, (u) =>
      prisma.transaction.update({
        where: { id: u.id },
        data: {
          confirmations: u.newConfirmations,
          // When a transaction transitions from 0 to confirmed, update rbfStatus
          // to 'confirmed' to prevent cleanup logic from incorrectly marking it as replaced
          ...(u.oldConfirmations === 0 && u.newConfirmations > 0 ? { rbfStatus: 'confirmed' } : {}),
        },
      }),
      walletId
    );
  }

  return updates.map(u => ({
    txid: u.txid,
    oldConfirmations: u.oldConfirmations,
    newConfirmations: u.newConfirmations,
  }));
}

/**
 * Populate missing transaction fields (blockHeight, addressId, blockTime, fee) from blockchain
 * Called during sync to fill in data for transactions that were created before
 * these fields existed or were populated
 * OPTIMIZED with batch fetching and batch updates
 * Returns both count and confirmation updates for notification broadcasting
 */
export async function populateMissingTransactionFields(walletId: string): Promise<PopulateFieldsResult> {
  // Get wallet to determine network for correct block height
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { network: true },
  });
  if (!wallet) {
    return { updated: 0, confirmationUpdates: [] };
  }

  const network = (wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';
  const client = await getNodeClient(network);

  // Find transactions with missing fields (including fee and counterparty address)
  // OPTIMIZED: Don't include all wallet addresses - fetch them separately with only needed fields
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
    select: {
      id: true,
      txid: true,
      type: true,
      amount: true,
      fee: true,
      blockHeight: true,
      blockTime: true,
      confirmations: true,
      addressId: true,
      counterpartyAddress: true,
    },
  });

  // Fetch wallet addresses separately with only needed fields (more memory efficient)
  const walletAddresses = await prisma.address.findMany({
    where: { walletId },
    select: { id: true, address: true },
  });

  // Attach addresses to a lookup structure for efficient access
  const walletAddressLookup = new Map(walletAddresses.map(a => [a.address, a.id]));
  const walletAddressSet = new Set(walletAddresses.map(a => a.address));

  if (transactions.length === 0) {
    walletLog(walletId, 'info', 'POPULATE', 'All transaction fields are complete');
    return { updated: 0, confirmationUpdates: [] };
  }

  log.debug(`Populating missing fields for ${transactions.length} transactions in wallet ${walletId}`);
  walletLog(walletId, 'info', 'POPULATE', `Starting field population for ${transactions.length} transactions`, {
    missingFields: {
      blockHeight: transactions.filter(t => t.blockHeight === null).length,
      fee: transactions.filter(t => t.fee === null).length,
      blockTime: transactions.filter(t => t.blockTime === null).length,
      counterpartyAddress: transactions.filter(t => t.counterpartyAddress === null).length,
      addressId: transactions.filter(t => t.addressId === null).length,
    },
  });

  const currentHeight = await getBlockHeight(network);

  // PHASE 0: Get block heights from address history (more reliable than verbose tx for some servers)
  // This handles servers like Blockstream that don't support verbose transaction responses
  const txHeightFromHistory = new Map<string, number>();

  // If any transactions are missing blockHeight, we need to check address history
  const hasMissingBlockHeight = transactions.some(tx => tx.blockHeight === null);
  const addressesForHistory = hasMissingBlockHeight ? walletAddressSet : new Set<string>();

  // Fetch address histories to get transaction heights
  const HISTORY_BATCH_SIZE = 10;
  const addressList = Array.from(addressesForHistory);

  if (addressList.length > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Fetching address history for ${addressList.length} addresses`);
  }

  for (let i = 0; i < addressList.length; i += HISTORY_BATCH_SIZE) {
    const batch = addressList.slice(i, i + HISTORY_BATCH_SIZE);
    const batchNum = Math.floor(i / HISTORY_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(addressList.length / HISTORY_BATCH_SIZE);

    walletLog(walletId, 'debug', 'POPULATE', `Address history batch ${batchNum}/${totalBatches} (${batch.length} addresses)`);

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

  if (txHeightFromHistory.size > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Found block heights for ${txHeightFromHistory.size} transactions from address history`);
  }

  // PHASE 1: Batch fetch all transaction details in parallel
  const TX_BATCH_SIZE = 5;
  const txDetailsCache = new Map<string, any>();
  const txids = transactions.map(tx => tx.txid);

  walletLog(walletId, 'info', 'POPULATE', `Fetching details for ${txids.length} transactions`);

  let fetchedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < txids.length; i += TX_BATCH_SIZE) {
    const batch = txids.slice(i, i + TX_BATCH_SIZE);
    const batchNum = Math.floor(i / TX_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(txids.length / TX_BATCH_SIZE);

    walletLog(walletId, 'debug', 'POPULATE', `Transaction batch ${batchNum}/${totalBatches} (${batch.length} txs)`);

    const results = await Promise.all(
      batch.map(async (txid) => {
        try {
          const details = await client.getTransaction(txid, true);
          return { txid, details };
        } catch (error) {
          log.warn(`Failed to fetch tx ${txid}`, { error: String(error) });
          return { txid, details: null };
        }
      })
    );
    for (const result of results) {
      if (result.details) {
        txDetailsCache.set(result.txid, result.details);
        fetchedCount++;
      } else {
        failedCount++;
      }
    }

    // Progress update every 5 batches or at the end
    if (batchNum % 5 === 0 || batchNum === totalBatches) {
      walletLog(walletId, 'info', 'POPULATE', `Transaction fetch progress: ${fetchedCount}/${txids.length} (${failedCount} failed)`);
    }
  }

  // PHASE 1.5: Batch fetch previous transactions needed for fee calculation and counterparty address
  // This fixes an N+1 query problem where we were fetching previous txs one-by-one in the loop
  const prevTxCache = new Map<string, any>();
  const requiredPrevTxids = new Set<string>();

  // First pass: collect all previous txids we'll need
  for (const tx of transactions) {
    const txDetails = txDetailsCache.get(tx.txid);
    if (!txDetails) continue;

    const inputs = txDetails.vin || [];
    const isSentTx = tx.type === 'sent' || tx.type === 'send';
    const isConsolidationTx = tx.type === 'consolidation';
    const isReceivedTx = tx.type === 'received' || tx.type === 'receive';

    // Need previous txs for fee calculation (sent/consolidation transactions without prevout data)
    if (tx.fee === null && (isSentTx || isConsolidationTx) && txDetails.fee == null) {
      for (const input of inputs) {
        if (!input.coinbase && !input.prevout && input.txid && input.vout != null) {
          requiredPrevTxids.add(input.txid);
        }
      }
    }

    // Need previous txs for counterparty address (received transactions without prevout data)
    if (tx.counterpartyAddress === null && isReceivedTx) {
      for (const input of inputs) {
        if (!input.coinbase && !input.prevout && input.txid && input.vout != null) {
          requiredPrevTxids.add(input.txid);
        }
      }
    }
  }

  // Batch fetch all required previous transactions
  if (requiredPrevTxids.size > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Batch fetching ${requiredPrevTxids.size} previous transactions for fee/address calculation`);

    const prevTxidsList = Array.from(requiredPrevTxids);
    let prevFetched = 0;
    let prevFailed = 0;

    for (let i = 0; i < prevTxidsList.length; i += TX_BATCH_SIZE) {
      const batch = prevTxidsList.slice(i, i + TX_BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (txid) => {
          try {
            const details = await client.getTransaction(txid, true);
            return { txid, details };
          } catch (error) {
            log.warn(`Failed to fetch previous tx ${txid}`, { error: String(error) });
            return { txid, details: null };
          }
        })
      );

      for (const result of results) {
        if (result.details) {
          prevTxCache.set(result.txid, result.details);
          prevFetched++;
        } else {
          prevFailed++;
        }
      }
    }

    walletLog(walletId, 'info', 'POPULATE', `Previous transactions fetched: ${prevFetched} success, ${prevFailed} failed`);
  }

  // Collect all pending updates
  const pendingUpdates: Array<{ id: string; txid: string; oldConfirmations: number; data: any }> = [];
  let updated = 0;

  walletLog(walletId, 'info', 'POPULATE', 'Processing transactions and calculating fields...');

  // Track what fields we're populating
  let feesPopulated = 0;
  let blockHeightsPopulated = 0;
  let blockTimesPopulated = 0;
  let counterpartyAddressesPopulated = 0;
  let addressIdsPopulated = 0;
  let processedCount = 0;
  const totalTxCount = transactions.length;
  const LOG_INTERVAL = 20; // Log progress every 20 transactions

  for (const tx of transactions) {
    processedCount++;

    // Log progress every LOG_INTERVAL transactions
    if (processedCount % LOG_INTERVAL === 0 || processedCount === totalTxCount) {
      walletLog(walletId, 'info', 'POPULATE', `Processing: ${processedCount}/${totalTxCount} (fees: ${feesPopulated}, heights: ${blockHeightsPopulated}, times: ${blockTimesPopulated})`);
    }
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
          blockHeightsPopulated++;
        } else if (txDetails?.confirmations && txDetails.confirmations > 0) {
          // Bitcoin Core RPC provides confirmations, calculate blockHeight
          const calculatedBlockHeight = currentHeight - txDetails.confirmations + 1;
          updates.blockHeight = calculatedBlockHeight;
          updates.confirmations = txDetails.confirmations;
          blockHeightsPopulated++;
        } else if (txHeightFromHistory.has(tx.txid)) {
          // Fallback: get height from address history (for servers like Blockstream that don't support verbose)
          const heightFromHistory = txHeightFromHistory.get(tx.txid)!;
          updates.blockHeight = heightFromHistory;
          updates.confirmations = Math.max(0, currentHeight - heightFromHistory + 1);
          blockHeightsPopulated++;
          log.debug(`Got blockHeight ${heightFromHistory} from address history for tx ${tx.txid}`);
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
          blockTimesPopulated++;
        } else if (tx.blockHeight || updates.blockHeight) {
          // Derive timestamp from block header if tx.time not available
          const height = updates.blockHeight || tx.blockHeight;
          const blockTime = await getBlockTimestamp(height, network);
          if (blockTime) {
            updates.blockTime = blockTime;
            blockTimesPopulated++;
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
          if (txDetails.fee != null && txDetails.fee > 0) {
            // Fee is in BTC, convert to sats
            const feeSats = Math.round(txDetails.fee * 100000000);
            // Sanity check: fee should be positive and less than 1 BTC
            if (feeSats > 0 && feeSats < 100000000) {
              updates.fee = BigInt(feeSats);
              // For consolidation transactions, amount should equal -fee
              if (isConsolidationTx && tx.amount === BigInt(0)) {
                updates.amount = BigInt(-feeSats);
              }
              feesPopulated++;
            } else {
              log.warn(`Invalid fee from Electrum for tx ${tx.txid}: ${txDetails.fee} BTC`);
            }
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
                // Use pre-fetched previous transaction from cache
                const prevTx = prevTxCache.get(input.txid);
                if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                  totalInputValue += Math.round(prevTx.vout[input.vout].value * 100000000);
                }
              }
            }

            // Only set fee if we successfully calculated inputs
            if (totalInputValue > 0 && totalInputValue >= totalOutputValue) {
              const fee = totalInputValue - totalOutputValue;
              if (fee > 0 && fee < 100000000) { // Sanity check: fee should be less than 1 BTC
                updates.fee = BigInt(fee);
                // For consolidation transactions, amount should equal -fee
                if (isConsolidationTx && tx.amount === BigInt(0)) {
                  updates.amount = BigInt(-fee);
                }
                feesPopulated++;
              }
            }
          }
        } catch (feeError) {
          log.warn(`Could not calculate fee for tx ${tx.txid}`, { error: String(feeError) });
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
                // Use pre-fetched previous transaction from cache
                const prevTx = prevTxCache.get(input.txid);
                if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                  const prevOutput = prevTx.vout[input.vout];
                  const senderAddr = prevOutput.scriptPubKey?.address ||
                    (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
                  if (senderAddr) {
                    updates.counterpartyAddress = senderAddr;
                    break;
                  }
                }
              }
            }
          } else if (isSentTx) {
            // For sent transactions, get the recipient address from outputs
            // Skip change outputs (outputs that go back to our wallet)
            for (const output of outputs) {
              const outputAddr = output.scriptPubKey?.address ||
                (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);
              // Skip if it's our own address (change output) - use walletAddressSet for O(1) lookup
              if (outputAddr && !walletAddressSet.has(outputAddr)) {
                updates.counterpartyAddress = outputAddr;
                break;
              }
            }
          }
        } catch (counterpartyError) {
          log.warn(`Could not get counterparty address for tx ${tx.txid}`, { error: String(counterpartyError) });
        }
      }

      // Populate addressId if missing - find which wallet address was involved
      // Use pre-fetched walletAddressSet and walletAddressLookup for O(1) lookups
      if (tx.addressId === null && walletAddresses.length > 0) {
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
              // Use walletAddressSet for O(1) check and walletAddressLookup for O(1) id retrieval
              if (walletAddressSet.has(addr)) {
                const addressId = walletAddressLookup.get(addr);
                if (addressId) {
                  updates.addressId = addressId;
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

              // Use walletAddressSet for O(1) check and walletAddressLookup for O(1) id retrieval
              if (inputAddress && walletAddressSet.has(inputAddress)) {
                const addressId = walletAddressLookup.get(inputAddress);
                if (addressId) {
                  updates.addressId = addressId;
                  break;
                }
              }
            }
          }
        }
      }

      // Collect updates if any
      if (Object.keys(updates).length > 0) {
        // Track what we're populating
        if (updates.fee !== undefined) feesPopulated++;
        if (updates.blockHeight !== undefined) blockHeightsPopulated++;
        if (updates.blockTime !== undefined) blockTimesPopulated++;
        if (updates.counterpartyAddress !== undefined) counterpartyAddressesPopulated++;
        if (updates.addressId !== undefined) addressIdsPopulated++;

        pendingUpdates.push({ id: tx.id, txid: tx.txid, oldConfirmations, data: updates });
      }
    } catch (error) {
      log.warn(`Failed to populate fields for tx ${tx.txid}`, { error: String(error) });
      walletLog(walletId, 'warn', 'POPULATE', `Failed to process tx ${tx.txid.slice(0, 8)}...`, { error: String(error) });
    }
  }

  // Log field population summary
  walletLog(walletId, 'info', 'POPULATE', `Fields calculated: ${pendingUpdates.length} transactions have updates`, {
    fees: feesPopulated,
    blockHeights: blockHeightsPopulated,
    blockTimes: blockTimesPopulated,
    counterpartyAddresses: counterpartyAddressesPopulated,
    addressIds: addressIdsPopulated,
  });

  // PHASE 2: Batch apply all updates in chunks to avoid long locks
  if (pendingUpdates.length > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Saving ${pendingUpdates.length} transaction updates to database...`);
    log.debug(`Applying ${pendingUpdates.length} transaction updates...`);
    await executeInChunks(
      pendingUpdates,
      (u) => prisma.transaction.update({
        where: { id: u.id },
        data: u.data,
      }),
      walletId
    );
    updated = pendingUpdates.length;
    walletLog(walletId, 'info', 'POPULATE', `Saved ${updated} transaction updates`);

    // Recalculate running balances if any amounts were updated
    const hasAmountUpdates = pendingUpdates.some(u => u.data.amount !== undefined);
    if (hasAmountUpdates) {
      walletLog(walletId, 'info', 'POPULATE', 'Recalculating running balances...');
      await recalculateWalletBalances(walletId);
    }
  } else {
    walletLog(walletId, 'info', 'POPULATE', 'No transaction updates needed');
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

  log.debug(`Populated missing fields for ${updated} transactions, ${confirmationUpdates.length} confirmation updates`);
  walletLog(walletId, 'info', 'POPULATE', `Field population complete: ${updated} transactions updated, ${confirmationUpdates.length} confirmation changes`);
  return { updated, confirmationUpdates };
}
