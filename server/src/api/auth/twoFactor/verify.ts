/**
 * Auth - Two-Factor Authentication Verification Route
 *
 * Endpoint for verifying 2FA code during login
 */

import { Router, Request, Response } from 'express';
import type { RequestHandler } from 'express';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { generateToken, verify2FAToken } from '../../../utils/jwt';
import * as twoFactorService from '../../../services/twoFactorService';
import * as refreshTokenService from '../../../services/refreshTokenService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../../services/auditService';

const log = createLogger('AUTH:2FA');

/**
 * Create the 2FA verification router
 * Rate limiter is passed from the parent auth.ts to centralize configuration
 */
export function createVerifyRouter(twoFactorLimiter: RequestHandler): Router {
  const router = Router();

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

  return router;
}
