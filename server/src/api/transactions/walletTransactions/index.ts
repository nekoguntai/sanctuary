/**
 * Transactions - Wallet Transactions Router
 *
 * Barrel file that composes all wallet transaction sub-routers into a single router.
 * Endpoints for listing, stats, pending, export, and recalculating wallet transactions.
 */

import { Router } from 'express';
import { createListTransactionsRouter } from './listTransactions';
import { createStatsRouter } from './stats';
import { createPendingRouter } from './pending';
import { createExportRouter } from './exportTransactions';
import { createRecalculateRouter } from './recalculate';

const router = Router();

// Mount all sub-routers
router.use(createListTransactionsRouter());
router.use(createStatsRouter());
router.use(createPendingRouter());
router.use(createExportRouter());
router.use(createRecalculateRouter());

export default router;
