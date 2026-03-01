/**
 * Auth - Two-Factor Authentication Router
 *
 * Barrel file that composes all 2FA sub-routers into a single router.
 * Endpoints for 2FA setup, verification, and backup code management.
 */

import { Router } from 'express';
import type { RequestHandler } from 'express';
import { createSetupRouter } from './setup';
import { createVerifyRouter } from './verify';
import { createManagementRouter } from './management';

const router = Router();

/**
 * Create the 2FA router with rate limiter
 * Rate limiter is passed from the parent auth.ts to centralize configuration
 */
export function createTwoFactorRouter(twoFactorLimiter: RequestHandler): Router {
  // Mount setup routes (setup, enable)
  router.use(createSetupRouter());

  // Mount verification route (verify during login)
  router.use(createVerifyRouter(twoFactorLimiter));

  // Mount management routes (disable, backup codes)
  router.use(createManagementRouter());

  return router;
}

export default router;
