/**
 * Auth - Two-Factor Authentication Router
 *
 * Endpoints for 2FA setup, verification, and backup code management
 */

import { Router, Request, Response } from 'express';
import type { RequestHandler } from 'express';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { verifyPassword } from '../../utils/password';
import { generateToken, verify2FAToken } from '../../utils/jwt';
import * as twoFactorService from '../../services/twoFactorService';
import * as refreshTokenService from '../../services/refreshTokenService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import { authenticate } from '../../middleware/auth';

const router = Router();
const log = createLogger('AUTH:2FA');

/**
 * Create the 2FA router with rate limiter
 * Rate limiter is passed from the parent auth.ts to centralize configuration
 */
export function createTwoFactorRouter(twoFactorLimiter: RequestHandler): Router {
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
   * POST /api/v1/auth/2fa/verify
   * Verify 2FA code during login (uses temporary token)
   */
  router.post('/2fa/verify', twoFactorLimiter, async (req: Request, res: Response) => {
    try {
      const { tempToken, code } = req.body;

      if (!tempToken || !code) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Temporary token and verification code are required',
        });
      }

      // SEC-006: Verify temp token with audience claim
      let decoded;
      try {
        decoded = await verify2FAToken(tempToken);
      } catch (err) {
        log.debug('2FA token verification failed', { error: (err as Error).message });
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired temporary token',
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid authentication state',
        });
      }

      // Check if it's a TOTP code or backup code
      let codeValid = false;
      let usedBackupCode = false;

      if (twoFactorService.isBackupCode(code)) {
        // Try backup code
        const backupResult = await twoFactorService.verifyBackupCode(user.twoFactorBackupCodes, code);
        if (backupResult.valid) {
          codeValid = true;
          usedBackupCode = true;
          // Update backup codes (mark as used)
          if (backupResult.updatedCodesJson) {
            await prisma.user.update({
              where: { id: user.id },
              data: { twoFactorBackupCodes: backupResult.updatedCodesJson },
            });
          }
        }
      } else {
        // Try TOTP code
        codeValid = twoFactorService.verifyToken(user.twoFactorSecret, code);
      }

      if (!codeValid) {
        // Audit failed 2FA
        const { ipAddress, userAgent } = getClientInfo(req);
        await auditService.log({
          userId: user.id,
          username: user.username,
          action: AuditAction.TWO_FACTOR_FAILED,
          category: AuditCategory.AUTH,
          ipAddress,
          userAgent,
          success: false,
          errorMsg: 'Invalid 2FA code',
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid verification code',
        });
      }

      // Get device info from request
      const { ipAddress, userAgent } = getClientInfo(req);
      const deviceInfo = {
        userAgent,
        ipAddress,
      };

      // SEC-005: Generate full auth token and refresh token with DB persistence
      const token = generateToken({
        userId: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
      });
      const refreshToken = await refreshTokenService.createRefreshToken(user.id, deviceInfo);

      // Audit successful login with 2FA
      await auditService.log({
        userId: user.id,
        username: user.username,
        action: usedBackupCode ? AuditAction.TWO_FACTOR_BACKUP_CODE_USED : AuditAction.TWO_FACTOR_VERIFIED,
        category: AuditCategory.AUTH,
        ipAddress,
        userAgent,
        success: true,
      });

      // Also audit the login itself
      await auditService.log({
        userId: user.id,
        username: user.username,
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
        ipAddress,
        userAgent,
        success: true,
        details: { via2FA: true, usedBackupCode },
      });

      res.json({
        token,
        refreshToken,
        expiresIn: 3600, // 1 hour in seconds
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isAdmin: user.isAdmin,
          preferences: user.preferences,
          twoFactorEnabled: user.twoFactorEnabled,
          usingDefaultPassword: decoded.usingDefaultPassword || false,
        },
      });
    } catch (error) {
      log.error('2FA verify error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify 2FA',
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

export default router;
