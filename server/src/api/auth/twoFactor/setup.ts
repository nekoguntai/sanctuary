/**
 * Auth - Two-Factor Authentication Setup Routes
 *
 * Endpoints for 2FA setup and enabling
 */

import { Router, Request, Response } from 'express';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import * as twoFactorService from '../../../services/twoFactorService';
import { auditService, AuditAction, AuditCategory } from '../../../services/auditService';
import { authenticate } from '../../../middleware/auth';

const log = createLogger('AUTH:2FA');

/**
 * Create the 2FA setup router
 */
export function createSetupRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/auth/2fa/setup
   * Start 2FA setup - generates secret and QR code
   */
  router.post('/2fa/setup', authenticate, async (req: Request, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
      });

      if (!user) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User not found',
        });
      }

      if (user.twoFactorEnabled) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '2FA is already enabled',
        });
      }

      // Generate secret and QR code
      const { secret, qrCodeDataUrl } = await twoFactorService.generateSecret(user.username);

      // Store secret temporarily (not enabled yet)
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: secret },
      });

      // Audit 2FA setup started
      await auditService.logFromRequest(req, AuditAction.TWO_FACTOR_SETUP, AuditCategory.AUTH, {
        details: { userId: user.id },
      });

      res.json({ secret, qrCodeDataUrl });
    } catch (error) {
      log.error('2FA setup error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to setup 2FA',
      });
    }
  });

  /**
   * POST /api/v1/auth/2fa/enable
   * Verify token and enable 2FA
   */
  router.post('/2fa/enable', authenticate, async (req: Request, res: Response) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Verification token is required',
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
      });

      if (!user) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User not found',
        });
      }

      if (!user.twoFactorSecret) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Please start 2FA setup first',
        });
      }

      if (user.twoFactorEnabled) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '2FA is already enabled',
        });
      }

      // Verify the token
      const isValid = twoFactorService.verifyToken(user.twoFactorSecret, token);

      if (!isValid) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid verification code',
        });
      }

      // Generate backup codes
      const backupCodes = twoFactorService.generateBackupCodes();
      const hashedBackupCodes = await twoFactorService.hashBackupCodes(backupCodes);

      // Enable 2FA
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorBackupCodes: hashedBackupCodes,
        },
      });

      // Audit 2FA enabled
      await auditService.logFromRequest(req, AuditAction.TWO_FACTOR_ENABLED, AuditCategory.AUTH, {
        details: { userId: user.id },
      });

      res.json({
        success: true,
        backupCodes, // Return plain-text codes for user to save (only shown once)
      });
    } catch (error) {
      log.error('2FA enable error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to enable 2FA',
      });
    }
  });

  return router;
}
