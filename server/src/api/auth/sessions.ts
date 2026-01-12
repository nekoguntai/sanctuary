/**
 * Auth - Sessions Router
 *
 * Endpoints for managing active user sessions
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../../utils/logger';
import { hashToken } from '../../utils/jwt';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import * as refreshTokenService from '../../services/refreshTokenService';

const router = Router();
const log = createLogger('AUTH:SESSIONS');

/**
 * GET /api/v1/auth/sessions
 * List all active sessions for the current user
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get current token hash to mark the current session
    // Client can send refresh token via X-Refresh-Token header to identify current session
    let currentTokenHash: string | undefined;
    const refreshTokenHeader = req.headers['x-refresh-token'];
    if (typeof refreshTokenHeader === 'string' && refreshTokenHeader) {
      currentTokenHash = hashToken(refreshTokenHeader);
    }

    const sessions = await refreshTokenService.getUserSessions(userId, currentTokenHash);

    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceName: s.deviceName || 'Unknown Device',
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        isCurrent: s.isCurrent,
      })),
      count: sessions.length,
    });
  } catch (error) {
    log.error('Get sessions error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get sessions',
    });
  }
});

/**
 * DELETE /api/v1/auth/sessions/:id
 * Revoke a specific session
 */
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.id;

    const revoked = await refreshTokenService.revokeSession(sessionId, userId);

    if (!revoked) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Session not found',
      });
    }

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
      details: { action: 'revoke_session', sessionId },
    });

    res.json({
      success: true,
      message: 'Session revoked successfully',
    });
  } catch (error) {
    log.error('Revoke session error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to revoke session',
    });
  }
});

export default router;
