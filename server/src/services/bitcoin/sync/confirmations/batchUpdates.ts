/**
 * Batch Database Updates
 *
 * Execute database updates in chunks to avoid long-running transactions
 * that can cause lock contention.
 */

import { transactionRepository } from '../../../../repositories';
import { getConfig } from '../../../../config';
import { walletLog } from '../../../../websocket/notifications';

/**
 * Execute database updates in chunks to avoid long-running transactions
 * that can cause lock contention. Uses the configured batch size.
 */
export async function executeInChunks(
  items: Array<{ id: string; data: Record<string, unknown> }>,
  walletId?: string
): Promise<void> {
  const config = getConfig();
  const batchSize = config.sync.transactionBatchSize;
  const totalChunks = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkNum = Math.floor(i / batchSize) + 1;

    if (walletId && totalChunks > 1) {
      walletLog(walletId, 'debug', 'DB', `Processing batch ${chunkNum}/${totalChunks} (${chunk.length} updates)`);
    }

    await transactionRepository.batchUpdateByIds(chunk, chunk.length);
  }
}
