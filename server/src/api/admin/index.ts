/**
 * Admin API Router Composition
 *
 * Composes all admin domain routers into a single admin router.
 * Routes are split by domain for maintainability:
 * - /users - User management
 * - /groups - Group management
 *
 * Additional routes remain in the legacy router and will be
 * progressively migrated to domain routers.
 */

import { Router } from 'express';
import usersRouter from './users';
import groupsRouter from './groups';

const router = Router();

// Domain routers (refactored)
router.use('/users', usersRouter);
router.use('/groups', groupsRouter);

// Note: Additional routes (node-config, settings, backup, audit-logs, electrum-servers, etc.)
// are handled by the legacy admin router until they are migrated.
// See ../admin.ts for these routes.

export default router;
