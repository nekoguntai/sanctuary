/**
 * Auth - Token Management Router
 *
 * Endpoints for token refresh and logout (SEC-003, SEC-005)
 */

import { Router, Request, Response } from 'express';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { generateToken, verifyRefreshToken, decodeToken } from '../../utils/jwt';
import { revokeToken, revokeAllUserTokens } from '../../services/tokenRevocation';
import * as refreshTokenService from '../../services/refreshTokenService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import { authenticate } from '../../middleware/auth';

const router = Router();
const log = createLogger('AUTH:TOKENS');

/**
 * POST /api/v1/auth/refresh
 * Exchange a refresh token for a new access token (SEC-005)
 * Supports optional token rotation for enhanced security
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken: refreshTokenStr, rotate } = req.body;

    if (!refreshTokenStr) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token JWT signature and expiration
    let decoded;
    try {
      decoded = await verifyRefreshToken(refreshTokenStr);
    } catch (err) {
      log.debug('Refresh token verification failed', { error: (err as Error).message });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    // Verify token exists in database (not already revoked)
    const tokenExists = await refreshTokenService.verifyRefreshTokenExists(refreshTokenStr);
    if (!tokenExists) {
      log.warn('Refresh token not found in database', { userId: decoded.userId });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token has been revoked',
      });
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found',
      });
    }

    // Generate new access token
    const newAccessToken = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    });

    // Get device info for potential rotation
    const { ipAddress, userAgent } = getClientInfo(req);
    const deviceInfo = { userAgent, ipAddress };

    // Token rotation if requested (more secure - invalidates old token)
    let newRefreshToken: string | undefined;
    if (rotate) {
      const rotatedToken = await refreshTokenService.rotateRefreshToken(refreshTokenStr, deviceInfo);
      if (rotatedToken) {
        newRefreshToken = rotatedToken;
      }
    }

    log.debug('Token refreshed', { userId: user.id, rotated: !!newRefreshToken });

    const response: Record<string, unknown> = {
      token: newAccessToken,
      expiresIn: 3600, // 1 hour in seconds
    };

    if (newRefreshToken) {
      response.refreshToken = newRefreshToken;
    }

    res.json(response);
  } catch (error) {
    log.error('Token refresh error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to refresh token',
    });
  }
});

/**
 * POST /api/v1/auth/logout
 * Revoke current access token and optionally the refresh token (SEC-003)
 */
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    const { refreshToken: refreshTokenStr } = req.body;

    // Revoke access token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = decodeToken(token);

      if (decoded?.jti && decoded?.exp) {
        const expiresAt = new Date(decoded.exp * 1000);
        await revokeToken(decoded.jti, expiresAt, req.user?.userId, 'user_logout');
        log.debug('Access token revoked on logout', { userId: req.user?.userId });
      }
    }

    // Revoke refresh token if provided
    if (refreshTokenStr) {
      await refreshTokenService.revokeRefreshToken(refreshTokenStr);
      log.debug('Refresh token revoked on logout', { userId: req.user?.userId });
    }

    // Audit logout
    const { ipAddress, userAgent } = getClientInfo(req);
    await auditService.log({
      userId: req.user?.userId,
      username: req.user?.username || 'unknown',
      action: AuditAction.LOGOUT,
      category: AuditCategory.AUTH,
      ipAddress,
      userAgent,
      success: true,
    });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    log.error('Logout error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to logout',
    });
  }
});

/**
 * POST /api/v1/auth/logout-all
 * Revoke all sessions for the current user (logout from all devices)
 */
router.post('/logout-all', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Revoke all refresh tokens for this user
    const revokedCount = await refreshTokenService.revokeAllUserRefreshTokens(userId);

    // Also revoke all access tokens (via the token revocation list)
    await revokeAllUserTokens(userId, 'logout_all_devices');

    // Audit the action
    const { ipAddress, userAgent } = getClientInfo(req);
    await auditService.log({
      userId,
      username: req.user?.username || 'unknown',
      action: AuditAction.LOGOUT,
      category: AuditCategory.AUTH,
      ipAddress,
      userAgent,
      success: true,
      details: { action: 'logout_all', sessionsRevoked: revokedCount },
    });

    log.info('User logged out from all devices', { userId, sessionsRevoked: revokedCount });

    res.json({
      success: true,
      message: 'Logged out from all devices',
      sessionsRevoked: revokedCount,
    });
  } catch (error) {
    log.error('Logout all error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to logout from all devices',
    });
  }
});

export default router;
