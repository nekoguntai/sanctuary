/**
 * Auth - Two-Factor Authentication Management Routes
 *
 * Endpoints for disabling 2FA and managing backup codes
 */

import { Router, Request, Response } from 'express';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { verifyPassword } from '../../../utils/password';
import * as twoFactorService from '../../../services/twoFactorService';
import { auditService, AuditAction, AuditCategory } from '../../../services/auditService';
import { authenticate } from '../../../middleware/auth';

const log = createLogger('AUTH:2FA');

/**
 * Create the 2FA management router
 */
export function createManagementRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/auth/2fa/disable
   * Disable 2FA (requires password and current 2FA token)
   */
  router.post('/2fa/disable', authenticate, async (req: Request, res: Response) => {
    try {
      const { password, token } = req.body;

      if (!password || !token) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password and 2FA token are required',
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

      if (!user.twoFactorEnabled) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '2FA is not enabled',
        });
      }

      // Verify password
      const passwordValid = await verifyPassword(password, user.password);
      if (!passwordValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid password',
        });
      }

      // Verify 2FA token (allow backup code too)
      let tokenValid = false;
      if (user.twoFactorSecret) {
        tokenValid = twoFactorService.verifyToken(user.twoFactorSecret, token);
      }

      if (!tokenValid && user.twoFactorBackupCodes) {
        const backupResult = await twoFactorService.verifyBackupCode(user.twoFactorBackupCodes, token);
        tokenValid = backupResult.valid;
      }

      if (!tokenValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid 2FA code',
        });
      }

      // Disable 2FA
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        },
      });

      // Audit 2FA disabled
      await auditService.logFromRequest(req, AuditAction.TWO_FACTOR_DISABLED, AuditCategory.AUTH, {
        details: { userId: user.id },
      });

      res.json({ success: true });
    } catch (error) {
      log.error('2FA disable error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to disable 2FA',
      });
    }
  });

  /**
   * POST /api/v1/auth/2fa/backup-codes
   * Get remaining backup codes count (requires password verification)
   * Changed from GET to POST to prevent password exposure in URL/logs
   */
  router.post('/2fa/backup-codes', authenticate, async (req: Request, res: Response) => {
    try {
      const { password } = req.body;

      if (!password || typeof password !== 'string') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password is required',
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

      // Verify password
      const passwordValid = await verifyPassword(password, user.password);
      if (!passwordValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid password',
        });
      }

      if (!user.twoFactorEnabled) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '2FA is not enabled',
        });
      }

      const remaining = twoFactorService.getRemainingBackupCodeCount(user.twoFactorBackupCodes);

      res.json({ remaining });
    } catch (error) {
      log.error('Get backup codes error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get backup codes',
      });
    }
  });

  /**
   * POST /api/v1/auth/2fa/backup-codes/regenerate
   * Generate new backup codes (requires password and 2FA token)
   */
  router.post('/2fa/backup-codes/regenerate', authenticate, async (req: Request, res: Response) => {
    try {
      const { password, token } = req.body;

      if (!password || !token) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password and 2FA token are required',
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

      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '2FA is not enabled',
        });
      }

      // Verify password
      const passwordValid = await verifyPassword(password, user.password);
      if (!passwordValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid password',
        });
      }

      // Verify 2FA token
      const tokenValid = twoFactorService.verifyToken(user.twoFactorSecret, token);
      if (!tokenValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid 2FA code',
        });
      }

      // Generate new backup codes
      const backupCodes = twoFactorService.generateBackupCodes();
      const hashedBackupCodes = await twoFactorService.hashBackupCodes(backupCodes);

      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorBackupCodes: hashedBackupCodes },
      });

      // Audit backup codes regenerated
      await auditService.logFromRequest(
        req,
        AuditAction.TWO_FACTOR_BACKUP_CODES_REGENERATED,
        AuditCategory.AUTH,
        { details: { userId: user.id } }
      );

      res.json({
        success: true,
        backupCodes,
      });
    } catch (error) {
      log.error('Regenerate backup codes error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to regenerate backup codes',
      });
    }
  });

  return router;
}
