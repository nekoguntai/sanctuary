/**
 * Email Verification Routes
 *
 * Handles email verification, resend, and email updates.
 */

import { Router, Request, Response } from 'express';
import type { RequestHandler } from 'express';
import { verifyEmail, resendVerification } from '../../services/email';
import { userRepository } from '../../repositories';
import { verifyPassword } from '../../utils/password';
import { VerifyEmailSchema, UpdateEmailSchema } from '../schemas/email';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { authenticate } from '../../middleware/auth';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';

const log = createLogger('auth:email');

/**
 * Create email verification router with rate limiters
 */
export function createEmailRouter(
  verifyLimiter: RequestHandler,
  resendLimiter: RequestHandler,
  updateLimiter: RequestHandler
): Router {
  const router = Router();

  /**
   * POST /api/v1/auth/email/verify
   *
   * Verify email address using token from email link.
   * Public endpoint (no auth required).
   */
  router.post('/email/verify', verifyLimiter, async (req, res: Response) => {
    try {
      const parseResult = VerifyEmailSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request',
          details: parseResult.error.issues,
        });
      }

      const { token } = parseResult.data;
      const result = await verifyEmail(token);

      if (!result.success) {
        // Map error codes to user-friendly messages
        const errorMessages: Record<string, string> = {
          INVALID_TOKEN: 'Invalid or expired verification link',
          EXPIRED_TOKEN: 'This verification link has expired. Please request a new one.',
          ALREADY_USED: 'This email has already been verified',
          USER_NOT_FOUND: 'User account not found',
          UNKNOWN_ERROR: 'An error occurred during verification',
        };

        log.warn('Email verification failed', { error: result.error });

        // Audit failed verification
        const { ipAddress, userAgent } = getClientInfo(req);
        await auditService.log({
          userId: result.userId,
          username: 'unknown',
          action: AuditAction.AUTH_EMAIL_VERIFICATION_FAILED,
          category: AuditCategory.AUTH,
          success: false,
          errorMsg: result.error,
          details: { error: result.error },
          ipAddress,
          userAgent,
        });

        return res.status(400).json({
          error: 'Verification Failed',
          message: errorMessages[result.error || 'UNKNOWN_ERROR'],
          code: result.error,
        });
      }

      // Audit successful verification
      const user = await userRepository.findById(result.userId!);
      const clientInfo = getClientInfo(req);
      await auditService.log({
        userId: result.userId!,
        username: user?.username || 'unknown',
        action: AuditAction.AUTH_EMAIL_VERIFIED,
        category: AuditCategory.AUTH,
        success: true,
        details: { email: result.email },
        ipAddress: clientInfo.ipAddress,
        userAgent: clientInfo.userAgent,
      });

      log.info('Email verified successfully', { userId: result.userId, email: result.email });

      return res.json({
        success: true,
        message: 'Email verified successfully',
        email: result.email,
      });
    } catch (error) {
      log.error('Email verification error', { error: getErrorMessage(error) });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'An error occurred during email verification',
      });
    }
  });

  /**
   * POST /api/v1/auth/email/resend
   *
   * Resend verification email to authenticated user.
   * Requires authentication.
   */
  router.post(
    '/email/resend',
    authenticate,
    resendLimiter,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;

        // Get user to retrieve email
        const user = await userRepository.findById(userId);
        if (!user) {
          return res.status(404).json({
            error: 'Not Found',
            message: 'User not found',
          });
        }

        const result = await resendVerification(userId);

        if (!result.success) {
          log.warn('Resend verification failed', { userId, error: result.error });
          return res.status(400).json({
            error: 'Resend Failed',
            message: result.error || 'Failed to resend verification email',
          });
        }

        // Audit email sent
        const { ipAddress, userAgent } = getClientInfo(req);
        await auditService.log({
          userId,
          username: req.user!.username,
          action: AuditAction.AUTH_EMAIL_VERIFICATION_SENT,
          category: AuditCategory.AUTH,
          success: true,
          details: { email: user.email },
          ipAddress,
          userAgent,
        });

        log.info('Verification email resent', { userId });

        return res.json({
          success: true,
          message: 'Verification email sent',
          expiresAt: result.expiresAt,
        });
      } catch (error) {
        log.error('Resend verification error', { error: getErrorMessage(error) });
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'An error occurred while sending verification email',
        });
      }
    }
  );

  /**
   * PUT /api/v1/auth/me/email
   *
   * Update email address. Requires password confirmation.
   * New email will need to be verified.
   */
  router.put(
    '/me/email',
    authenticate,
    updateLimiter,
    async (req: Request, res: Response) => {
      try {
        const parseResult = UpdateEmailSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            error: 'Validation Error',
            message: 'Invalid request',
            details: parseResult.error.issues,
          });
        }

        const { email, password } = parseResult.data;
        const userId = req.user!.userId;

        // Get full user record to verify password
        const user = await userRepository.findById(userId);
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

        // Check if email is already in use
        if (email.toLowerCase() !== user.email?.toLowerCase()) {
          const emailExists = await userRepository.emailExists(email);
          if (emailExists) {
            return res.status(409).json({
              error: 'Conflict',
              message: 'This email address is already in use',
            });
          }
        }

        // Update email (this resets verification status)
        const updatedUser = await userRepository.updateEmail(userId, email.toLowerCase());

        // Audit email update
        const { ipAddress, userAgent } = getClientInfo(req);
        await auditService.log({
          userId,
          username: user.username,
          action: AuditAction.USER_EMAIL_UPDATED,
          category: AuditCategory.USER,
          success: true,
          details: {
            oldEmail: user.email,
            newEmail: email.toLowerCase(),
          },
          ipAddress,
          userAgent,
        });

        // Send verification email to new address
        const { createVerificationToken } = await import('../../services/email');
        const verificationResult = await createVerificationToken(userId, email.toLowerCase(), user.username);

        log.info('Email updated', {
          userId,
          oldEmail: user.email,
          newEmail: email.toLowerCase(),
          verificationSent: verificationResult.success,
        });

        return res.json({
          success: true,
          message: 'Email updated. Please check your inbox for verification.',
          email: updatedUser.email,
          emailVerified: updatedUser.emailVerified,
          verificationSent: verificationResult.success,
        });
      } catch (error) {
        log.error('Email update error', { error: getErrorMessage(error) });
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'An error occurred while updating email',
        });
      }
    }
  );

  return router;
}

export default createEmailRouter;
