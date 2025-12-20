/**
 * Authentication API Routes
 *
 * Handles user authentication (login, register, etc.)
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../models/prisma';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../utils/password';
import {
  generateToken,
  generate2FAToken,
  generateRefreshToken,
  verifyToken,
  verify2FAToken,
  verifyRefreshToken,
  decodeToken,
  getTokenExpiration,
  TokenAudience,
} from '../utils/jwt';
import { authenticate } from '../middleware/auth';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../services/auditService';
import * as twoFactorService from '../services/twoFactorService';
import { revokeToken } from '../services/tokenRevocation';
import { createLogger } from '../utils/logger';

const log = createLogger('AUTH');

const router = Router();

// Rate limiters for authentication endpoints
// Express app has trust proxy enabled; disable all validations (we know our proxy setup is correct)
// This suppresses the IPv6 warnings when running behind nginx
const rateLimitValidations = false;

// Rate limit can be configured via environment variable for testing
// Default: 5 attempts per 15 minutes (production)
// Set LOGIN_RATE_LIMIT=100 for testing environments
const loginRateLimit = parseInt(process.env.LOGIN_RATE_LIMIT || '5', 10);

// Strict limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: loginRateLimit,
  message: {
    error: 'Too Many Requests',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidations,
  keyGenerator: (req) => {
    // Use IP + username combination to prevent targeted attacks
    const username = req.body?.username?.toLowerCase() || 'unknown';
    return `${req.ip}-${username}`;
  },
});

// Limiter for registration (10 attempts per hour per IP)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour
  message: {
    error: 'Too Many Requests',
    message: 'Too many registration attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidations,
});

// Limiter for 2FA verification (10 attempts per 15 minutes)
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  message: {
    error: 'Too Many Requests',
    message: 'Too many 2FA attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidations,
});

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
    let enabled = false;
    if (setting) {
      try {
        enabled = JSON.parse(setting.value);
      } catch {
        enabled = false;
      }
    }

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

    let registrationEnabled = false;
    if (setting) {
      try {
        registrationEnabled = JSON.parse(setting.value);
      } catch {
        registrationEnabled = false;
      }
    }

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

    // SEC-005: Generate access token (1h) and refresh token (7d)
    const token = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    });
    const refreshToken = generateRefreshToken(user.id);

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

// Default password detection
// Instead of hardcoding a password, we check against a system setting
// that stores whether the initial admin password has been changed.
// The initial password is now generated randomly during first setup (see seed.ts).
// We still need to detect if user is using the initial password by checking a marker.
async function isUsingInitialPassword(userId: string, password: string): Promise<boolean> {
  try {
    // Check if the user's password matches the initial generated password hash
    // stored in system settings during first setup
    const initialPasswordSetting = await prisma.systemSetting.findUnique({
      where: { key: `initialPassword_${userId}` },
    });

    if (!initialPasswordSetting) {
      // No initial password marker - user was created after initial setup
      // or marker was cleared after password change
      return false;
    }

    // The setting stores the hash of the initial password
    // If the current password matches, user hasn't changed it
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });

    if (!user) return false;

    // Check if current password matches the initial password hash stored in settings
    return initialPasswordSetting.value === user.password;
  } catch (error) {
    log.error('Error checking initial password status', { error });
    return false;
  }
}

// Mark initial password as changed (remove the marker)
async function clearInitialPasswordMarker(userId: string): Promise<void> {
  try {
    await prisma.systemSetting.deleteMany({
      where: { key: `initialPassword_${userId}` },
    });
  } catch (error) {
    log.error('Error clearing initial password marker', { error });
  }
}

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

    // SEC-005: Generate access token (1h) and refresh token (7d)
    const token = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    });
    const refreshToken = generateRefreshToken(user.id);

    // Audit successful login
    const { ipAddress, userAgent } = getClientInfo(req);
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

/**
 * GET /api/v1/auth/me
 * Get current authenticated user
 */
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        preferences: true,
        createdAt: true,
        twoFactorEnabled: true,
        password: true, // Need this to check default password
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Check if user is still using the initial password
    // We check by looking for the initial password marker in system settings
    const initialPasswordSetting = await prisma.systemSetting.findUnique({
      where: { key: `initialPassword_${user.id}` },
    });
    const usingDefaultPassword = initialPasswordSetting?.value === user.password;

    // Don't send the password hash to the client
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      ...userWithoutPassword,
      usingDefaultPassword,
    });
  } catch (error) {
    log.error('Get me error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user',
    });
  }
});

/**
 * PATCH /api/v1/auth/me/preferences
 * Update user preferences
 */
router.patch('/me/preferences', authenticate, async (req: Request, res: Response) => {
  try {
    const newPreferences = req.body;

    // Default preferences for new users or those with null preferences
    const defaultPreferences = {
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
    };

    // First get current preferences to merge with
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { preferences: true },
    });

    // Merge: defaults -> existing preferences -> new preferences
    const mergedPreferences = {
      ...defaultPreferences,
      ...(currentUser?.preferences as object || {}),
      ...newPreferences,
    };

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        preferences: mergedPreferences,
      },
      select: {
        id: true,
        username: true,
        preferences: true,
      },
    });

    res.json(user);
  } catch (error) {
    log.error('Update preferences error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update preferences',
    });
  }
});

/**
 * GET /api/v1/auth/me/groups
 * Get groups the current user is a member of
 */
router.get('/me/groups', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const groups = await prisma.group.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        members: {
          select: {
            userId: true,
            role: true,
          },
        },
      },
    });

    res.json(groups.map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      memberCount: g.members.length,
      memberIds: g.members.map(m => m.userId),
    })));
  } catch (error) {
    log.error('Get user groups error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get groups',
    });
  }
});

/**
 * GET /api/v1/auth/users/search
 * Search users by username (for sharing)
 */
router.get('/users/search', authenticate, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Search query must be at least 2 characters',
      });
    }

    const users = await prisma.user.findMany({
      where: {
        username: {
          contains: q,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        username: true,
      },
      take: 10,
    });

    res.json(users);
  } catch (error) {
    log.error('Search users error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to search users',
    });
  }
});

/**
 * POST /api/v1/auth/me/change-password
 * Change user password
 */
router.post('/me/change-password', authenticate, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password must be at least 6 characters',
      });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password);

    if (!isValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Current password is incorrect',
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
      },
    });

    // Clear the initial password marker since user has changed their password
    await clearInitialPasswordMarker(user.id);

    // Audit password change
    await auditService.logFromRequest(req, AuditAction.PASSWORD_CHANGE, AuditCategory.AUTH, {
      details: { userId: user.id },
    });

    res.json({
      message: 'Password changed successfully',
    });
  } catch (error) {
    log.error('Change password error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to change password',
    });
  }
});

// ========================================
// TWO-FACTOR AUTHENTICATION ENDPOINTS
// ========================================

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
      decoded = verify2FAToken(tempToken);
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

    // SEC-005: Generate full auth token and refresh token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    });
    const refreshToken = generateRefreshToken(user.id);

    // Audit successful login with 2FA
    const { ipAddress, userAgent } = getClientInfo(req);
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

// ============================================================================
// TELEGRAM NOTIFICATIONS
// ============================================================================

/**
 * POST /api/v1/auth/telegram/chat-id
 * Fetch chat ID from bot's recent messages (user must message the bot first)
 */
router.post('/telegram/chat-id', authenticate, async (req: Request, res: Response) => {
  try {
    const { botToken } = req.body;

    if (!botToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Bot token is required',
      });
    }

    const { getChatIdFromBot } = await import('../services/telegram/telegramService');
    const result = await getChatIdFromBot(botToken);

    if (result.success) {
      res.json({
        success: true,
        chatId: result.chatId,
        username: result.username,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to fetch chat ID',
      });
    }
  } catch (error) {
    log.error('Telegram chat-id fetch error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch chat ID',
    });
  }
});

/**
 * POST /api/v1/auth/telegram/test
 * Test Telegram configuration by sending a test message
 */
router.post('/telegram/test', authenticate, async (req: Request, res: Response) => {
  try {
    const { botToken, chatId } = req.body;

    if (!botToken || !chatId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Bot token and chat ID are required',
      });
    }

    // Import telegram service
    const { testTelegramConfig } = await import('../services/telegram/telegramService');
    const result = await testTelegramConfig(botToken, chatId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Test message sent successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to send test message',
      });
    }
  } catch (error) {
    log.error('Telegram test error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to test Telegram configuration',
    });
  }
});

// ============================================================================
// TOKEN MANAGEMENT (SEC-003, SEC-005)
// ============================================================================

/**
 * POST /api/v1/auth/refresh
 * Exchange a refresh token for a new access token (SEC-005)
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken: refreshTokenStr } = req.body;

    if (!refreshTokenStr) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshTokenStr);
    } catch (err) {
      log.debug('Refresh token verification failed', { error: (err as Error).message });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
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
    const newToken = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    });

    // Optionally rotate refresh token (more secure but requires client update)
    // For now, we keep the same refresh token until it expires

    log.debug('Token refreshed', { userId: user.id });

    res.json({
      token: newToken,
      expiresIn: 3600, // 1 hour in seconds
    });
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
 * Revoke current access token (SEC-003)
 */
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    // Extract the token to revoke it
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = decodeToken(token);

      if (decoded?.jti && decoded?.exp) {
        // Revoke the token
        const expiresAt = new Date(decoded.exp * 1000);
        revokeToken(decoded.jti, expiresAt, 'user_logout');
        log.debug('Token revoked on logout', { userId: req.user?.userId });
      }
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
 * POST /api/v1/auth/revoke
 * Revoke a specific refresh token (for "sign out of all devices" feature)
 */
router.post('/revoke', authenticate, async (req: Request, res: Response) => {
  try {
    const { refreshToken: refreshTokenStr } = req.body;

    if (!refreshTokenStr) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
      });
    }

    // Decode the refresh token to get its jti
    try {
      const decoded = verifyRefreshToken(refreshTokenStr);

      // Verify the token belongs to this user
      if (decoded.userId !== req.user?.userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot revoke tokens for other users',
        });
      }

      // Calculate expiration from refresh token (7 days from issue)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      revokeToken(decoded.jti, expiresAt, 'user_revoked');

      log.debug('Refresh token revoked', { userId: req.user?.userId });
    } catch {
      // Token already invalid/expired, that's fine
    }

    res.json({
      success: true,
      message: 'Token revoked successfully',
    });
  } catch (error) {
    log.error('Token revoke error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to revoke token',
    });
  }
});

export default router;
