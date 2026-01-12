/**
 * Device API Routes
 *
 * Hardware device management, accounts, and sharing endpoints
 *
 * Route domains extracted to ./devices/ subdirectory:
 * - models.ts   - Public device catalog (models, manufacturers)
 * - crud.ts     - Device lifecycle (list, create, get, update, delete)
 * - accounts.ts - Device account management (multi-xpub)
 * - sharing.ts  - User and group access control
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';

// Domain routers
import modelsRouter from './devices/models';
import crudRouter from './devices/crud';
import accountsRouter from './devices/accounts';
import sharingRouter from './devices/sharing';

const router = Router();

// Public routes (device catalog - no auth required)
router.use('/', modelsRouter);

// Apply authentication to remaining routes
router.use(authenticate);

// Authenticated routes
router.use('/', crudRouter);
router.use('/', accountsRouter);
router.use('/', sharingRouter);

export default router;
