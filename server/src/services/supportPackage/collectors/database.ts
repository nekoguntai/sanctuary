/**
 * Database Collector
 *
 * Collects table row counts from pg_stat_user_tables.
 * No PII — only table names and approximate row counts.
 */

import { maintenanceRepository } from '../../../repositories';
import { getErrorMessage, bigIntToNumberOrZero } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('database', async () => {
  try {
    const tableStats = await maintenanceRepository.getTableStats();

    const tables: Record<string, number> = {};
    for (const row of tableStats) {
      tables[row.relname] = bigIntToNumberOrZero(row.n_live_tup);
    }

    return { tables };
  } catch (error) {
    return { error: getErrorMessage(error), tables: {} };
  }
});
