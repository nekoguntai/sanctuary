/**
 * Backfill Transaction Inputs/Outputs
 *
 * This script populates the transaction_inputs and transaction_outputs tables
 * for existing transactions that were created before these tables existed.
 *
 * Run with: npx ts-node src/scripts/backfillTransactionIO.ts
 */

import prisma from '../models/prisma';
import { getNodeClient } from '../services/bitcoin/nodeClient';
import { createLogger } from '../utils/logger';

const log = createLogger('BACKFILL');

interface BackfillStats {
  totalTransactions: number;
  processed: number;
  inputsCreated: number;
  outputsCreated: number;
  errors: number;
}

async function backfillTransactionIO(): Promise<BackfillStats> {
  const stats: BackfillStats = {
    totalTransactions: 0,
    processed: 0,
    inputsCreated: 0,
    outputsCreated: 0,
    errors: 0,
  };

  log.info('[BACKFILL] Starting transaction I/O backfill...');

  // Find all transactions that don't have any inputs or outputs stored
  const transactionsWithoutIO = await prisma.transaction.findMany({
    where: {
      inputs: { none: {} },
      outputs: { none: {} },
    },
    include: {
      wallet: {
        include: {
          addresses: {
            select: { address: true, derivationPath: true },
          },
        },
      },
    },
    orderBy: { blockTime: 'asc' },
  });

  stats.totalTransactions = transactionsWithoutIO.length;
  log.info(`[BACKFILL] Found ${stats.totalTransactions} transactions to backfill`);

  if (stats.totalTransactions === 0) {
    log.info('[BACKFILL] No transactions need backfilling');
    return stats;
  }

  const client = await getNodeClient();
  if (!client.isConnected()) {
    await client.connect();
  }

  // Process in batches to avoid overwhelming the Electrum server
  const BATCH_SIZE = 10;

  for (let i = 0; i < transactionsWithoutIO.length; i += BATCH_SIZE) {
    const batch = transactionsWithoutIO.slice(i, i + BATCH_SIZE);

    log.info(`[BACKFILL] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(stats.totalTransactions / BATCH_SIZE)}`);

    // Fetch transaction details for this batch
    const txDetailsMap = new Map<string, any>();

    for (const tx of batch) {
      try {
        const details = await client.getTransaction(tx.txid, true);
        txDetailsMap.set(tx.txid, details);
      } catch (error) {
        log.warn(`[BACKFILL] Failed to fetch tx ${tx.txid}: ${error}`);
        stats.errors++;
      }
    }

    // Process each transaction in the batch
    for (const tx of batch) {
      try {
        const txDetails = txDetailsMap.get(tx.txid);
        if (!txDetails) {
          stats.errors++;
          continue;
        }

        const inputs = txDetails.vin || [];
        const outputs = txDetails.vout || [];

        // Build wallet address set and derivation path map
        const walletAddressSet = new Set(tx.wallet.addresses.map(a => a.address));
        const addressToDerivationPath = new Map<string, string>();
        for (const addr of tx.wallet.addresses) {
          if (addr.derivationPath) {
            addressToDerivationPath.set(addr.address, addr.derivationPath);
          }
        }

        const inputsToCreate: Array<{
          transactionId: string;
          inputIndex: number;
          txid: string;
          vout: number;
          address: string;
          amount: bigint;
          derivationPath?: string;
        }> = [];

        const outputsToCreate: Array<{
          transactionId: string;
          outputIndex: number;
          address: string;
          amount: bigint;
          scriptPubKey?: string;
          outputType: string;
          isOurs: boolean;
        }> = [];

        // Process inputs
        for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
          const input = inputs[inputIdx];
          if (input.coinbase) continue;

          let inputAddress: string | undefined;
          let inputAmount = 0;

          // Try to get input info from prevout (verbose mode)
          if (input.prevout && input.prevout.scriptPubKey) {
            inputAddress = input.prevout.scriptPubKey.address ||
              (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
            if (input.prevout.value !== undefined) {
              inputAmount = input.prevout.value >= 1000000
                ? input.prevout.value  // already in sats
                : Math.round(input.prevout.value * 100000000);  // BTC to sats
            }
          } else if (input.txid && input.vout !== undefined) {
            // Need to fetch previous transaction
            try {
              const prevTx = await client.getTransaction(input.txid, true);
              if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
                const prevOutput = prevTx.vout[input.vout];
                inputAddress = prevOutput.scriptPubKey?.address ||
                  (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
                if (prevOutput.value !== undefined) {
                  inputAmount = Math.round(prevOutput.value * 100000000);
                }
              }
            } catch (e) {
              // Skip if we can't look up the prev tx
            }
          }

          if (inputAddress && input.txid !== undefined && input.vout !== undefined) {
            inputsToCreate.push({
              transactionId: tx.id,
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

          if (!outputAddress) continue; // Skip OP_RETURN or non-standard outputs

          const outputAmount = Math.round((output.value || 0) * 100000000);
          const isOurs = walletAddressSet.has(outputAddress);

          // Classify output type based on transaction type and ownership
          let outputType = 'unknown';
          if (tx.type === 'sent' || tx.type === 'send') {
            outputType = isOurs ? 'change' : 'recipient';
          } else if (tx.type === 'received' || tx.type === 'receive') {
            outputType = isOurs ? 'recipient' : 'unknown';
          } else if (tx.type === 'consolidation') {
            outputType = 'consolidation';
          }

          outputsToCreate.push({
            transactionId: tx.id,
            outputIndex: outputIdx,
            address: outputAddress,
            amount: BigInt(outputAmount),
            scriptPubKey: output.scriptPubKey?.hex,
            outputType,
            isOurs,
          });
        }

        // Insert inputs and outputs
        if (inputsToCreate.length > 0) {
          await prisma.transactionInput.createMany({
            data: inputsToCreate,
            skipDuplicates: true,
          });
          stats.inputsCreated += inputsToCreate.length;
        }

        if (outputsToCreate.length > 0) {
          await prisma.transactionOutput.createMany({
            data: outputsToCreate,
            skipDuplicates: true,
          });
          stats.outputsCreated += outputsToCreate.length;
        }

        stats.processed++;

        if (stats.processed % 50 === 0) {
          log.info(`[BACKFILL] Progress: ${stats.processed}/${stats.totalTransactions} transactions processed`);
        }
      } catch (error) {
        log.error(`[BACKFILL] Error processing tx ${tx.txid}: ${error}`);
        stats.errors++;
      }
    }

    // Small delay between batches to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  log.info('[BACKFILL] Backfill complete!');
  log.info(`[BACKFILL] Stats: ${stats.processed} transactions, ${stats.inputsCreated} inputs, ${stats.outputsCreated} outputs, ${stats.errors} errors`);

  return stats;
}

// Run the backfill
backfillTransactionIO()
  .then((stats) => {
    console.log('\nBackfill completed successfully!');
    console.log(`Processed: ${stats.processed}/${stats.totalTransactions} transactions`);
    console.log(`Created: ${stats.inputsCreated} inputs, ${stats.outputsCreated} outputs`);
    console.log(`Errors: ${stats.errors}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
