/**
 * Admin Settings Router
 *
 * Endpoints for system settings management (admin only)
 */

import { Router, Request, Response } from 'express';
import prisma from '../../models/prisma';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import {
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
  DEFAULT_DUST_THRESHOLD,
  DEFAULT_DRAFT_EXPIRATION_DAYS,
  DEFAULT_AI_ENABLED,
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
} from '../../constants';

const router = Router();
const log = createLogger('ADMIN:SETTINGS');

/**
 * GET /api/v1/admin/settings
 * Get all system settings (admin only)
 */
router.get('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany();

    // Convert to key-value object with parsed JSON values
    const settingsObj: Record<string, any> = {};
    for (const setting of settings) {
      try {
        settingsObj[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsObj[setting.key] = setting.value;
      }
    }

    // Return defaults for any missing settings
    res.json({
      registrationEnabled: false, // Default to disabled (admin-only)
      confirmationThreshold: DEFAULT_CONFIRMATION_THRESHOLD,
      deepConfirmationThreshold: DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
      dustThreshold: DEFAULT_DUST_THRESHOLD,
      draftExpirationDays: DEFAULT_DRAFT_EXPIRATION_DAYS,
      aiEnabled: DEFAULT_AI_ENABLED,
      aiEndpoint: DEFAULT_AI_ENDPOINT,
      aiModel: DEFAULT_AI_MODEL,
      ...settingsObj,
    });
  } catch (error) {
    log.error('Get settings error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get system settings',
    });
  }
});

/**
 * PUT /api/v1/admin/settings
 * Update system settings (admin only)
 */
router.put('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const updates = req.body;

    // Validate confirmation thresholds relationship
    if (updates.confirmationThreshold !== undefined || updates.deepConfirmationThreshold !== undefined) {
      // Get current values for comparison
      const currentSettings = await prisma.systemSetting.findMany({
        where: { key: { in: ['confirmationThreshold', 'deepConfirmationThreshold'] } },
      });
      const currentValues: Record<string, number> = {
        confirmationThreshold: DEFAULT_CONFIRMATION_THRESHOLD,
        deepConfirmationThreshold: DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
      };
      for (const s of currentSettings) {
        try {
          currentValues[s.key] = JSON.parse(s.value);
        } catch {
          // Keep default
        }
      }

      const newConfirmation = updates.confirmationThreshold ?? currentValues.confirmationThreshold;
      const newDeepConfirmation = updates.deepConfirmationThreshold ?? currentValues.deepConfirmationThreshold;

      if (newDeepConfirmation < newConfirmation) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Deep confirmation threshold must be greater than or equal to confirmation threshold',
        });
      }
    }

    // Validate and update each setting
    for (const [key, value] of Object.entries(updates)) {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: JSON.stringify(value) },
        create: { key, value: JSON.stringify(value) },
      });
    }

    log.info('Settings updated', { keys: Object.keys(updates) });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.SYSTEM_SETTING_UPDATE, AuditCategory.SYSTEM, {
      details: { settings: Object.keys(updates) },
    });

    // Return updated settings
    const settings = await prisma.systemSetting.findMany();
    const settingsObj: Record<string, any> = {
      registrationEnabled: false, // Default to disabled (admin-only)
      confirmationThreshold: DEFAULT_CONFIRMATION_THRESHOLD,
      deepConfirmationThreshold: DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
      dustThreshold: DEFAULT_DUST_THRESHOLD,
      draftExpirationDays: DEFAULT_DRAFT_EXPIRATION_DAYS,
      aiEnabled: DEFAULT_AI_ENABLED,
      aiEndpoint: DEFAULT_AI_ENDPOINT,
      aiModel: DEFAULT_AI_MODEL,
    };
    for (const setting of settings) {
      try {
        settingsObj[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsObj[setting.key] = setting.value;
      }
    }

    res.json(settingsObj);
  } catch (error) {
    log.error('Update settings error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update system settings',
    });
  }
});

export default router;
