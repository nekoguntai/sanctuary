/**
 * Process Transactions Phase
 *
 * The most complex phase - handles:
 * 1. Batch fetching transaction details
 * 2. Classifying transactions (received/sent/consolidation)
 * 3. Creating transaction records with inputs/outputs
 * 4. RBF detection and linking
 * 5. Auto-applying address labels
 * 6. Sending notifications
 */

import prisma from '../../../../models/prisma';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import { getBlockTimestamp } from '../../utils/blockHeight';
import { recalculateWalletBalances } from '../../utils/balanceCalculation';
import type { SyncContext, TransactionCreateData, TxInputCreateData, TxOutputCreateData } from '../types';

const log = createLogger('SYNC-TX');

/** Number of transactions to process per batch */
const TX_BATCH_SIZE = 10;

/**
 * Helper to check if output matches an address
 */
function outputMatchesAddress(out: any, address: string): boolean {
  if (out.scriptPubKey?.address === address) return true;
  if (out.scriptPubKey?.addresses?.includes(address)) return true;
  return false;
}

/**
 * Execute process transactions phase
 *
 * Fetches and processes new transactions in batches, saving progress
 * incrementally to support interrupted syncs.
 */
export async function processTransactionsPhase(ctx: SyncContext): Promise<SyncContext> {
  const {
    walletId,
    client,
    newTxids,
    historyResults,
    addressMap,
    walletAddressSet,
    addressToDerivationPath,
    currentBlockHeight,
    existingTxMap,
    txDetailsCache,
  } = ctx;

  if (newTxids.length === 0) {
    return ctx;
  }

  walletLog(walletId, 'info', 'SYNC', `Processing ${newTxids.length} new transactions...`);

  let totalTransactions = 0;
  const allNewTransactions: TransactionCreateData[] = [];

  // Process transactions in batches
  for (let batchIndex = 0; batchIndex < newTxids.length; batchIndex += TX_BATCH_SIZE) {
    const batchTxids = newTxids.slice(batchIndex, batchIndex + TX_BATCH_SIZE);
    const batchNumber = Math.floor(batchIndex / TX_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(newTxids.length / TX_BATCH_SIZE);

    walletLog(
      walletId,
      'info',
      'SYNC',
      `Fetching transactions ${batchIndex + 1}-${Math.min(batchIndex + TX_BATCH_SIZE, newTxids.length)} of ${newTxids.length}...`
    );

    // Step 1: Fetch this batch of transactions
    try {
      const batchResults = await client.getTransactionsBatch(batchTxids, true);
      for (const [txid, details] of batchResults) {
        txDetailsCache.set(txid, details);
      }
    } catch (error) {
      log.warn(`[SYNC] Batch tx fetch failed, falling back to individual requests`, { error: String(error) });
      for (const txid of batchTxids) {
        try {
          const details = await client.getTransaction(txid, true);
          txDetailsCache.set(txid, details);
        } catch (e) {
          log.warn(`[SYNC] Failed to get tx ${txid}`, { error: String(e) });
        }
      }
    }

    const batchTxidSet = new Set(batchTxids.filter(txid => txDetailsCache.has(txid)));

    // Step 2: Process transactions in this batch
    const transactionsToCreate: TransactionCreateData[] = [];

    for (const [addressStr, history] of historyResults) {
      const addressRecord = addressMap.get(addressStr)!;

      for (const item of history) {
        if (!batchTxidSet.has(item.tx_hash)) continue;

        const txDetails = txDetailsCache.get(item.tx_hash);
        if (!txDetails) continue;

        const outputs = txDetails.vout || [];
        const inputs = txDetails.vin || [];

        const isReceived = outputs.some((out: any) => outputMatchesAddress(out, addressStr));

        // Get block timestamp
        let blockTime: Date | null = null;
        if (txDetails.time) {
          blockTime = new Date(txDetails.time * 1000);
        } else if (item.height > 0) {
          blockTime = await getBlockTimestamp(item.height);
        }

        const confirmations = item.height > 0 ? Math.max(0, currentBlockHeight - item.height + 1) : 0;

        // Check if wallet sent funds (any wallet address in inputs)
        let isSent = false;
        let hasVerboseInputs = false;

        for (const input of inputs) {
          if (input.coinbase) continue;

          let inputAddr: string | undefined;
          if (input.prevout && input.prevout.scriptPubKey) {
            hasVerboseInputs = true;
            inputAddr = input.prevout.scriptPubKey.address ||
              (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
          } else if (input.txid && input.vout !== undefined) {
            const prevTx = txDetailsCache.get(input.txid);
            if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
              const prevOutput = prevTx.vout[input.vout];
              inputAddr = prevOutput.scriptPubKey?.address ||
                (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
            } else {
              try {
                const fetchedPrevTx = await client.getTransaction(input.txid);
                if (fetchedPrevTx && fetchedPrevTx.vout && fetchedPrevTx.vout[input.vout]) {
                  const prevOutput = fetchedPrevTx.vout[input.vout];
                  inputAddr = prevOutput.scriptPubKey?.address ||
                    (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
                  txDetailsCache.set(input.txid, fetchedPrevTx);
                }
              } catch (e) {
                // Skip if we can't look up the prev tx
              }
            }
          }

          if (inputAddr && walletAddressSet.has(inputAddr)) {
            isSent = true;
            if (hasVerboseInputs) break;
          }
        }

        // Calculate output destinations
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

        // Calculate total inputs for fee
        let totalInputs = 0;
        if (isSent) {
          for (const input of inputs) {
            if (input.coinbase) continue;
            let inputValue = 0;
            if (input.prevout && input.prevout.value !== undefined) {
              inputValue = input.prevout.value >= 1000000
                ? input.prevout.value
                : Math.round(input.prevout.value * 100000000);
            } else if (input.txid && input.vout !== undefined) {
              const prevTx = txDetailsCache.get(input.txid);
              if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                inputValue = Math.round(prevTx.vout[input.vout].value * 100000000);
              }
            }
            totalInputs += inputValue;
          }
        }

        const calculatedFee = isSent && totalInputs > 0 ? totalInputs - totalOutputs : null;
        const fee = calculatedFee !== null && calculatedFee >= 0 ? calculatedFee : null;

        // Determine transaction type
        const isConsolidation = isSent && totalToExternal === 0 && totalToWallet > 0;

        if (isConsolidation && !existingTxMap.has(`${item.tx_hash}:consolidation`)) {
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
            rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
          });
          existingTxMap.set(`${item.tx_hash}:consolidation`, true);
        } else if (isSent && totalToExternal > 0 && !existingTxMap.has(`${item.tx_hash}:sent`)) {
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
            rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
          });
          existingTxMap.set(`${item.tx_hash}:sent`, true);
        } else if (!isSent && isReceived && !existingTxMap.has(`${item.tx_hash}:received`)) {
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
            rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
          });
          existingTxMap.set(`${item.tx_hash}:received`, true);
        }
      }
    }

    // Step 3: Insert batch to DB
    if (transactionsToCreate.length > 0) {
      // Deduplicate by txid:type
      const uniqueTxs = new Map<string, TransactionCreateData>();
      for (const tx of transactionsToCreate) {
        const key = `${tx.txid}:${tx.type}`;
        if (!uniqueTxs.has(key)) {
          uniqueTxs.set(key, tx);
        }
      }

      const uniqueTxArray = Array.from(uniqueTxs.values());

      // Check for existing
      const existingTxids = new Set(
        (await prisma.transaction.findMany({
          where: {
            walletId,
            txid: { in: uniqueTxArray.map(tx => tx.txid) },
          },
          select: { txid: true },
        })).map(tx => tx.txid)
      );

      const newTransactions = uniqueTxArray.filter(tx => !existingTxids.has(tx.txid));

      if (newTransactions.length > 0) {
        await prisma.transaction.createMany({
          data: uniqueTxArray,
          skipDuplicates: true,
        });

        totalTransactions += newTransactions.length;
        allNewTransactions.push(...newTransactions);

        // Log batch results
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

        // Store transaction inputs/outputs
        await storeTransactionIO(ctx, newTransactions);

        // Auto-apply address labels
        await applyAddressLabels(walletId, newTransactions);

        // Send notifications
        await sendNotifications(walletId, newTransactions);
      }
    }

    // Small delay between batches
    if (batchIndex + TX_BATCH_SIZE < newTxids.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Recalculate running balances
  if (allNewTransactions.length > 0) {
    await recalculateWalletBalances(walletId);

    const received = allNewTransactions.filter(t => t.type === 'received').length;
    const sent = allNewTransactions.filter(t => t.type === 'sent').length;
    const consolidation = allNewTransactions.filter(t => t.type === 'consolidation').length;

    walletLog(walletId, 'info', 'BLOCKCHAIN', `Recorded ${totalTransactions} new transactions`, {
      received,
      sent,
      consolidation,
    });
  }

  ctx.newTransactions = allNewTransactions;
  ctx.stats.newTransactionsCreated = totalTransactions;
  ctx.stats.transactionsProcessed = newTxids.length;

  return ctx;
}

/**
 * Store transaction inputs and outputs in the database
 */
async function storeTransactionIO(
  ctx: SyncContext,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  const { walletId, txDetailsCache, walletAddressSet, addressToDerivationPath } = ctx;

  try {
    const createdTxRecords = await prisma.transaction.findMany({
      where: {
        walletId,
        txid: { in: newTransactions.map(tx => tx.txid) },
      },
      select: { id: true, txid: true, type: true },
    });

    const txInputsToCreate: TxInputCreateData[] = [];
    const txOutputsToCreate: TxOutputCreateData[] = [];

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

      // RBF detection
      await detectRBFReplacements(walletId, createdTxRecords, newTransactions, txInputsToCreate);
    }

    if (txOutputsToCreate.length > 0) {
      await prisma.transactionOutput.createMany({
        data: txOutputsToCreate,
        skipDuplicates: true,
      });
    }
  } catch (ioError) {
    log.warn(`[SYNC] Failed to store transaction inputs/outputs: ${ioError}`);
  }
}

/**
 * Detect and link RBF replacements
 */
async function detectRBFReplacements(
  walletId: string,
  createdTxRecords: Array<{ id: string; txid: string; type: string }>,
  newTransactions: TransactionCreateData[],
  txInputsToCreate: TxInputCreateData[]
): Promise<void> {
  const confirmedTxRecords = createdTxRecords.filter(tx => {
    const txData = newTransactions.find(t => t.txid === tx.txid);
    return txData && txData.confirmations > 0;
  });

  if (confirmedTxRecords.length === 0) return;

  const confirmedInputPatterns: Array<{ confirmedTxid: string; inputTxid: string; inputVout: number }> = [];
  for (const txRecord of confirmedTxRecords) {
    const inputs = txInputsToCreate.filter(i => i.transactionId === txRecord.id);
    for (const input of inputs) {
      confirmedInputPatterns.push({
        confirmedTxid: txRecord.txid,
        inputTxid: input.txid,
        inputVout: input.vout,
      });
    }
  }

  if (confirmedInputPatterns.length === 0) return;

  const pendingTxsWithMatchingInputs = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: {
        some: {
          OR: confirmedInputPatterns.map(p => ({
            txid: p.inputTxid,
            vout: p.inputVout,
          })),
        },
      },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });

  const rbfUpdates: Array<{ id: string; txid: string; replacementTxid: string }> = [];

  for (const pendingTx of pendingTxsWithMatchingInputs) {
    const pendingInputKeys = new Set(pendingTx.inputs.map(i => `${i.txid}:${i.vout}`));
    const replacementTxid = confirmedInputPatterns.find(p =>
      pendingInputKeys.has(`${p.inputTxid}:${p.inputVout}`)
    )?.confirmedTxid;

    if (replacementTxid && replacementTxid !== pendingTx.txid) {
      rbfUpdates.push({ id: pendingTx.id, txid: pendingTx.txid, replacementTxid });
    }
  }

  if (rbfUpdates.length > 0) {
    await prisma.$transaction(
      rbfUpdates.map(update =>
        prisma.transaction.update({
          where: { id: update.id },
          data: {
            rbfStatus: 'replaced',
            replacedByTxid: update.replacementTxid,
          },
        })
      )
    );

    for (const update of rbfUpdates) {
      walletLog(
        walletId,
        'info',
        'RBF',
        `Linked pending tx ${update.txid.slice(0, 8)}... as replaced by confirmed tx ${update.replacementTxid.slice(0, 8)}...`
      );
    }
  }
}

/**
 * Auto-apply address labels to new transactions
 */
async function applyAddressLabels(
  walletId: string,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  try {
    const addressIds = [...new Set(newTransactions.map(tx => tx.addressId).filter(Boolean))] as string[];
    if (addressIds.length === 0) return;

    const addressLabels = await prisma.addressLabel.findMany({
      where: { addressId: { in: addressIds } },
    });

    if (addressLabels.length === 0) return;

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
  } catch (labelError) {
    log.warn(`[SYNC] Failed to auto-apply address labels: ${labelError}`);
  }
}

/**
 * Send notifications for new transactions
 */
async function sendNotifications(
  walletId: string,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  try {
    // Push notifications
    const { notifyNewTransactions } = await import('../../../notifications/notificationService');
    notifyNewTransactions(walletId, newTransactions.map(tx => ({
      txid: tx.txid,
      type: tx.type,
      amount: tx.amount,
    }))).catch(err => {
      log.warn(`[SYNC] Failed to send notifications: ${err}`);
    });

    // WebSocket events
    const { getNotificationService } = await import('../../../../websocket/notifications');
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
  } catch (notifyError) {
    log.warn(`[SYNC] Failed to send notifications: ${notifyError}`);
  }
}
