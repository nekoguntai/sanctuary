/**
 * Admin Audit Logs Router
 *
 * Endpoints for viewing audit logs and statistics (admin only)
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { auditService, AuditCategory } from '../../services/auditService';

const router = Router();

/**
 * GET /api/v1/admin/audit-logs
 * Get audit logs with optional filters (admin only)
 *
 * Query parameters:
 *   - userId: Filter by user ID
 *   - username: Filter by username (partial match)
 *   - action: Filter by action (partial match)
 *   - category: Filter by category (auth, user, wallet, device, admin, backup, system)
 *   - success: Filter by success status (true/false)
 *   - startDate: Filter by start date (ISO string)
 *   - endDate: Filter by end date (ISO string)
 *   - limit: Number of records (default 50, max 500)
 *   - offset: Skip records for pagination
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    userId,
    username,
    action,
    category,
    success,
    startDate,
    endDate,
    limit,
    offset,
  } = req.query;

  const result = await auditService.query({
    userId: userId as string,
    username: username as string,
    action: action as string,
    category: category as AuditCategory,
    success: success !== undefined ? success === 'true' : undefined,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
    limit: Math.min(parseInt(limit as string, 10) || 50, 500),
    offset: parseInt(offset as string, 10) || 0,
  });

  res.json(result);
}));

/**
 * GET /api/v1/admin/audit-logs/stats
 * Get audit log statistics (admin only)
 *
 * Query parameters:
 *   - days: Number of days to include (default 30)
 */
router.get('/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days as string, 10) || 30;
  const stats = await auditService.getStats(days);
  res.json(stats);
}));

export default router;
