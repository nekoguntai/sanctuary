/**
 * Blockchain Service
 *
 * High-level service for interacting with the Bitcoin blockchain.
 * Handles address monitoring, transaction fetching, and UTXO management.
 */

import { getElectrumClient } from './electrum';
import prisma from '../../models/prisma';
import { validateAddress, parseTransaction } from './utils';

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
    const client = getElectrumClient();
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
    console.error(`[BLOCKCHAIN] Failed to get timestamp for block ${height}:`, error);
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

  const client = getElectrumClient();

  try {
    // Ensure connection
    if (!client.isConnected()) {
      await client.connect();
    }

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
      const existingTx = await prisma.transaction.findUnique({
        where: { txid: item.tx_hash },
      });

      if (existingTx) {
        continue;
      }

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
            console.error(`[BLOCKCHAIN] Failed to look up input tx ${input.txid}:`, e);
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

      // Record sent transaction if our wallet addresses were in inputs
      // This detects when we're spending from this wallet (even if we also receive change)
      if (isSent) {
        // Calculate how much was sent to external addresses (non-wallet addresses)
        let totalToExternal = 0;
        for (const out of outputs) {
          const outAddr = out.scriptPubKey?.address ||
            (out.scriptPubKey?.addresses && out.scriptPubKey.addresses[0]);
          // Count output as "sent" if it goes to an address outside our wallet
          if (outAddr && !walletAddressSet.has(outAddr)) {
            totalToExternal += Math.round(out.value * 100000000);
          }
        }

        if (totalToExternal > 0) {
          // Check if we already recorded this as a sent tx (could be from another address sync)
          const existingSentTx = await prisma.transaction.findFirst({
            where: { txid: item.tx_hash, walletId: addressRecord.walletId, type: 'sent' },
          });

          if (!existingSentTx) {
            await prisma.transaction.create({
              data: {
                txid: item.tx_hash,
                walletId: addressRecord.walletId,
                addressId: addressRecord.id,
                type: 'sent',
                amount: BigInt(totalToExternal),
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
    console.error('[BLOCKCHAIN] Sync address error:', error);
    throw error;
  }
}

/**
 * Sync all addresses for a wallet
 */
export async function syncWallet(walletId: string): Promise<{
  addresses: number;
  transactions: number;
  utxos: number;
}> {
  const addresses = await prisma.address.findMany({
    where: { walletId },
  });

  let totalTransactions = 0;
  let totalUtxos = 0;

  for (const address of addresses) {
    try {
      const result = await syncAddress(address.id);
      totalTransactions += result.transactions;
      totalUtxos += result.utxos;
    } catch (error) {
      console.error(`[BLOCKCHAIN] Failed to sync address ${address.address}:`, error);
      // Continue with other addresses
    }
  }

  return {
    addresses: addresses.length,
    transactions: totalTransactions,
    utxos: totalUtxos,
  };
}

/**
 * Get current block height
 */
export async function getBlockHeight(): Promise<number> {
  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

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
    console.error('[BLOCKCHAIN] Failed to get confirmations:', error);
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
  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

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
  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

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
    console.error('[BLOCKCHAIN] Failed to get fee estimates:', error);
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
  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

  return client.getTransaction(txid, true);
}

/**
 * Monitor address for new transactions
 * Subscribe to address and get notifications
 */
export async function monitorAddress(address: string): Promise<string> {
  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

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
  const client = getElectrumClient();

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
 * Update confirmations for pending transactions
 */
export async function updateTransactionConfirmations(walletId: string): Promise<number> {
  const transactions = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: 6 }, // Only update transactions with less than 6 confirmations
    },
  });

  let updated = 0;

  for (const tx of transactions) {
    if (tx.blockHeight) {
      try {
        const confirmations = await getConfirmations(tx.blockHeight);

        if (confirmations !== tx.confirmations) {
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { confirmations },
          });
          updated++;
        }
      } catch (error) {
        console.error(`[BLOCKCHAIN] Failed to update confirmations for ${tx.txid}:`, error);
      }
    }
  }

  return updated;
}

/**
 * Populate missing transaction fields (blockHeight, addressId, blockTime, fee) from blockchain
 * Called during sync to fill in data for transactions that were created before
 * these fields existed or were populated
 */
export async function populateMissingTransactionFields(walletId: string): Promise<number> {
  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

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
    return 0;
  }

  console.log(`[BLOCKCHAIN] Populating missing fields for ${transactions.length} transactions in wallet ${walletId}`);

  let updated = 0;
  const currentHeight = await getBlockHeight();

  for (const tx of transactions) {
    try {
      // Fetch transaction details from blockchain (verbose mode to get more details)
      const txDetails = await client.getTransaction(tx.txid, true);

      if (!txDetails) {
        console.error(`[BLOCKCHAIN] Could not fetch details for tx ${tx.txid}`);
        continue;
      }

      const updates: any = {};

      // Populate blockHeight if missing
      if (tx.blockHeight === null && txDetails.blockheight) {
        updates.blockHeight = txDetails.blockheight;
        updates.confirmations = Math.max(0, currentHeight - txDetails.blockheight + 1);
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
      const isReceivedTx = tx.type === 'received' || tx.type === 'receive';

      // Populate fee if missing - only for sent transactions (receiver doesn't pay fees)
      if (tx.fee === null && isSentTx) {
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
                  console.error(`[BLOCKCHAIN] Could not fetch input tx ${input.txid}:`, e);
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
          console.error(`[BLOCKCHAIN] Could not calculate fee for tx ${tx.txid}:`, feeError);
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
                  console.error(`[BLOCKCHAIN] Could not fetch input tx for sender address:`, e);
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
          console.error(`[BLOCKCHAIN] Could not get counterparty address for tx ${tx.txid}:`, counterpartyError);
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

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: updates,
        });
        updated++;
        console.log(`[BLOCKCHAIN] Updated tx ${tx.txid.slice(0, 8)}... with:`, Object.keys(updates).join(', '));
      }
    } catch (error) {
      console.error(`[BLOCKCHAIN] Failed to populate fields for tx ${tx.txid}:`, error);
    }
  }

  console.log(`[BLOCKCHAIN] Populated missing fields for ${updated} transactions`);
  return updated;
}
