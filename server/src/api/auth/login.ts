/**
 * Auth - Login Router
 *
 * Public authentication endpoints (registration, login)
 */

import { Router, Request, Response } from 'express';
import type { RequestHandler } from 'express';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../utils/password';
import { generateToken, generate2FAToken } from '../../utils/jwt';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import * as refreshTokenService from '../../services/refreshTokenService';
import { safeJsonParse, SystemSettingSchemas } from '../../utils/safeJson';
import { isUsingInitialPassword } from './password';

const router = Router();
const log = createLogger('AUTH:LOGIN');

/**
 * Create the login router with rate limiters
 * Rate limiters are passed from the parent auth.ts to centralize configuration
 */
export function createLoginRouter(
  loginLimiter: RequestHandler,
  registerLimiter: RequestHandler
): Router {
  /**
   * GET /api/v1/auth/registration-status
   * Check if public registration is enabled (public endpoint for login page)
   */
  router.get('/registration-status', async (req: Request, res: Response) => {
    try {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: 'registrationEnabled' },
      });

      // Default to disabled if setting doesn't exist (admin-only)
      const enabled = setting
        ? safeJsonParse(setting.value, SystemSettingSchemas.boolean, false, 'registrationEnabled')
        : false;

      res.json({ enabled });
    } catch (error) {
      log.error('Check registration status error', { error });
      // Default to disabled on error (admin-only)
      res.json({ enabled: false });
    }
  });

  /**
   * POST /api/v1/auth/register
   * Register a new user
   */
  router.post('/register', registerLimiter, async (req: Request, res: Response) => {
    try {
      // Check if registration is enabled (default: disabled / admin-only)
      const setting = await prisma.systemSetting.findUnique({
        where: { key: 'registrationEnabled' },
      });

      const registrationEnabled = setting
        ? safeJsonParse(setting.value, SystemSettingSchemas.boolean, false, 'registrationEnabled')
        : false;

      if (!registrationEnabled) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Public registration is disabled. Please contact an administrator.',
        });
      }

      const { username, password, email } = req.body;

      // Validation
      if (!username || !password) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Username and password are required',
        });
      }

      // SEC-009: Enforce password strength at registration
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password does not meet strength requirements',
          details: passwordValidation.errors,
        });
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUser) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Username already exists',
        });
      }

      // Hash password
      const hashedPassword = await hashPassword(password);

      // Create user with default preferences
      const user = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          email,
          preferences: {
            darkMode: true,
            theme: 'sanctuary',
            background: 'zen',
            unit: 'sats',
            fiatCurrency: 'USD',
            showFiat: true,
            priceProvider: 'auto',
            notificationSounds: {
              enabled: true,
              volume: 50,
              confirmation: { enabled: true, sound: 'chime' },
              receive: { enabled: true, sound: 'coin' },
              send: { enabled: true, sound: 'success' },
            },
          },
        },
      });

      // Get device info from request
      const { ipAddress, userAgent } = getClientInfo(req);
      const deviceInfo = {
        userAgent,
        ipAddress,
      };

      // SEC-005: Generate access token (1h) and refresh token (7d)
      const token = generateToken({
        userId: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
      });
      const refreshToken = await refreshTokenService.createRefreshToken(user.id, deviceInfo);

      res.status(201).json({
        token,
        refreshToken,
        expiresIn: 3600, // 1 hour in seconds
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isAdmin: user.isAdmin,
          preferences: user.preferences,
        },
      });
    } catch (error) {
      log.error('Register error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to register user',
      });
    }
  });

  /**
   * POST /api/v1/auth/login
   * Login existing user
   */
  router.post('/login', loginLimiter, async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      // Validation
      if (!username || !password) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Username and password are required',
        });
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { username },
      });

      if (!user) {
        // Audit failed login (user not found)
        const { ipAddress, userAgent } = getClientInfo(req);
        await auditService.log({
          username,
          action: AuditAction.LOGIN_FAILED,
          category: AuditCategory.AUTH,
          ipAddress,
          userAgent,
          success: false,
          errorMsg: 'User not found',
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid username or password',
        });
      }

      // Verify password
      const isValid = await verifyPassword(password, user.password);

      if (!isValid) {
        // Audit failed login (wrong password)
        const { ipAddress, userAgent } = getClientInfo(req);
        await auditService.log({
          userId: user.id,
          username: user.username,
          action: AuditAction.LOGIN_FAILED,
          category: AuditCategory.AUTH,
          ipAddress,
          userAgent,
          success: false,
          errorMsg: 'Invalid password',
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid username or password',
        });
      }

      // Check if 2FA is enabled
      if (user.twoFactorEnabled && user.twoFactorSecret) {
        // Check if using initial password before creating temp token
        const usingDefaultPassword = await isUsingInitialPassword(user.id, password);

        // SEC-006: Generate a 2FA temp token with distinct audience claim
        const tempToken = generate2FAToken({
          userId: user.id,
          username: user.username,
          isAdmin: user.isAdmin,
          usingDefaultPassword, // Pass through for after 2FA verification
        });

        return res.json({
          requires2FA: true,
          tempToken,
        });
      }

      // Get device info from request
      const { ipAddress, userAgent } = getClientInfo(req);
      const deviceInfo = {
        userAgent,
        ipAddress,
      };

      // SEC-005: Generate access token (1h) and refresh token (7d) with DB persistence
      const token = generateToken({
        userId: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
      });
      const refreshToken = await refreshTokenService.createRefreshToken(user.id, deviceInfo);

      // Audit successful login
      await auditService.log({
        userId: user.id,
        username: user.username,
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
        ipAddress,
        userAgent,
        success: true,
      });

      // Check if using initial password (for admin user warning)
      const usingDefaultPassword = await isUsingInitialPassword(user.id, password);

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
          usingDefaultPassword,
        },
      });
    } catch (error) {
      log.error('Login error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to login',
      });
    }
  });

  return router;
}

export default router;
