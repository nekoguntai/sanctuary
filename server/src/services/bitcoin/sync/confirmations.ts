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

const log = createLogger('CONFIRMATIONS');

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

  log.debug(`Populating missing fields for ${transactions.length} transactions in wallet ${walletId}`);

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
          log.warn(`Failed to fetch tx ${txid}`, { error: String(error) });
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
                  log.warn(`Could not fetch input tx ${input.txid}`, { error: String(e) });
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
                  log.warn(`Could not fetch input tx for sender address`, { error: String(e) });
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
          log.warn(`Could not get counterparty address for tx ${tx.txid}`, { error: String(counterpartyError) });
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
      log.warn(`Failed to populate fields for tx ${tx.txid}`, { error: String(error) });
    }
  }

  // PHASE 2: Batch apply all updates
  if (pendingUpdates.length > 0) {
    log.debug(`Applying ${pendingUpdates.length} transaction updates...`);
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

  log.debug(`Populated missing fields for ${updated} transactions, ${confirmationUpdates.length} confirmation updates`);
  return { updated, confirmationUpdates };
}
