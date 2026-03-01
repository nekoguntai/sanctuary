/**
 * Email Verification Service Tests
 *
 * Tests for email verification token generation, validation, and management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

// Hoist mocks
const {
  mockEmailVerificationRepository,
  mockUserRepository,
  mockSystemSettingRepository,
  mockEmailService,
  mockConfig,
} = vi.hoisted(() => {
  const mockEmailVerificationRepository = {
    create: vi.fn(),
    findByTokenHash: vi.fn(),
    findPendingByUserId: vi.fn(),
    markUsed: vi.fn(),
    deleteExpired: vi.fn(),
    deleteUnusedByUserId: vi.fn(),
    countCreatedSince: vi.fn(),
  };

  const mockUserRepository = {
    findById: vi.fn(),
    updateEmailVerification: vi.fn(),
    updateEmail: vi.fn(),
  };

  const mockSystemSettingRepository = {
    getValue: vi.fn(),
    getNumber: vi.fn(),
    getBoolean: vi.fn(),
  };

  const mockEmailService = {
    sendEmail: vi.fn(),
    isSmtpConfigured: vi.fn(),
  };

  const mockConfig = {
    server: {
      clientUrl: 'http://localhost:3000',
      port: 3001,
    },
  };

  return {
    mockEmailVerificationRepository,
    mockUserRepository,
    mockSystemSettingRepository,
    mockEmailService,
    mockConfig,
  };
});

// Mock dependencies
vi.mock('../../../../src/repositories', () => ({
  emailVerificationRepository: mockEmailVerificationRepository,
  userRepository: mockUserRepository,
  systemSettingRepository: mockSystemSettingRepository,
  SystemSettingKeys: {
    EMAIL_VERIFICATION_REQUIRED: 'email.verificationRequired',
    EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS: 'email.tokenExpiryHours',
    SERVER_NAME: 'serverName',
  },
}));

vi.mock('../../../../src/services/email/emailService', () => mockEmailService);

vi.mock('../../../../src/config', () => ({
  default: mockConfig,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  createVerificationToken,
  verifyEmail,
  resendVerification,
  isVerificationRequired,
  isEmailVerified,
  cleanupExpiredTokens,
} from '../../../../src/services/email/emailVerificationService';

describe('Email Verification Service', () => {
  const testUserId = faker.string.uuid();
  const testEmail = faker.internet.email().toLowerCase();
  const testUsername = faker.internet.username();
  const testTokenId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default settings
    mockSystemSettingRepository.getNumber.mockResolvedValue(24);
    mockSystemSettingRepository.getBoolean.mockResolvedValue(true);
    mockSystemSettingRepository.getValue.mockResolvedValue(null);
  });

  describe('createVerificationToken', () => {
    it('should fail when SMTP is not configured', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(false);

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result).toEqual({
        success: false,
        error: 'SMTP not configured',
      });
      expect(mockEmailVerificationRepository.create).not.toHaveBeenCalled();
    });

    it('should create token when SMTP is configured', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.deleteUnusedByUserId.mockResolvedValue(undefined);
      mockEmailVerificationRepository.create.mockResolvedValue({
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      });
      mockEmailService.sendEmail.mockResolvedValue({ success: true, messageId: 'msg-123' });

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result.success).toBe(true);
      expect(result.tokenId).toBe(testTokenId);
      expect(result.expiresAt).toBeDefined();
      expect(mockEmailVerificationRepository.deleteUnusedByUserId).toHaveBeenCalledWith(testUserId);
      expect(mockEmailVerificationRepository.create).toHaveBeenCalled();
      expect(mockEmailService.sendEmail).toHaveBeenCalled();
    });

    it('should delete existing unused tokens before creating new one', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.deleteUnusedByUserId.mockResolvedValue(undefined);
      mockEmailVerificationRepository.create.mockResolvedValue({
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      });
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      await createVerificationToken(testUserId, testEmail, testUsername);

      expect(mockEmailVerificationRepository.deleteUnusedByUserId).toHaveBeenCalledWith(testUserId);
      expect(mockEmailVerificationRepository.deleteUnusedByUserId).toHaveBeenCalledBefore(
        mockEmailVerificationRepository.create
      );
    });

    it('should use custom expiry hours from settings', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockSystemSettingRepository.getNumber.mockResolvedValue(48); // 48 hours
      mockEmailVerificationRepository.deleteUnusedByUserId.mockResolvedValue(undefined);
      mockEmailVerificationRepository.create.mockResolvedValue({
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      });
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result.success).toBe(true);
      // Verify the expiry time is ~48 hours from now
      const expiresAt = result.expiresAt!;
      const expectedExpiry = Date.now() + 48 * 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeCloseTo(expectedExpiry, -4); // Within 10 seconds
    });

    it('should handle email sending failure gracefully', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.deleteUnusedByUserId.mockResolvedValue(undefined);
      mockEmailVerificationRepository.create.mockResolvedValue({
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      });
      mockEmailService.sendEmail.mockResolvedValue({ success: false, error: 'SMTP error' });

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP error');
      expect(result.tokenId).toBe(testTokenId); // Token was created even if email failed
    });

    it('should fall back to localhost verification URL when client URL is not configured', async () => {
      const originalClientUrl = mockConfig.server.clientUrl;
      mockConfig.server.clientUrl = '';
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.deleteUnusedByUserId.mockResolvedValue(undefined);
      mockEmailVerificationRepository.create.mockResolvedValue({
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      });
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      await createVerificationToken(testUserId, testEmail, testUsername);

      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('http://localhost:3000/verify-email?token='),
        })
      );
      mockConfig.server.clientUrl = originalClientUrl;
    });

    it('should hash the token before storing', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.deleteUnusedByUserId.mockResolvedValue(undefined);
      mockEmailVerificationRepository.create.mockResolvedValue({
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(),
        createdAt: new Date(),
        usedAt: null,
      });
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      await createVerificationToken(testUserId, testEmail, testUsername);

      const createCall = mockEmailVerificationRepository.create.mock.calls[0][0];
      // Token hash should be a 64-character hex string (SHA256)
      expect(createCall.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return service error when token creation flow throws', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.deleteUnusedByUserId.mockRejectedValue(new Error('delete failed'));

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result).toEqual({
        success: false,
        error: 'delete failed',
      });
    });
  });

  describe('verifyEmail', () => {
    const mockToken = {
      id: testTokenId,
      userId: testUserId,
      email: testEmail,
      tokenHash: 'hashed-token',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      usedAt: null,
    };

    const mockUser = {
      id: testUserId,
      username: testUsername,
      email: testEmail,
      emailVerified: false,
    };

    it('should reject invalid token', async () => {
      mockEmailVerificationRepository.findByTokenHash.mockResolvedValue(null);

      const result = await verifyEmail('invalid-token');

      expect(result).toEqual({
        success: false,
        error: 'INVALID_TOKEN',
      });
    });

    it('should reject expired token', async () => {
      const expiredToken = {
        ...mockToken,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      };
      mockEmailVerificationRepository.findByTokenHash.mockResolvedValue(expiredToken);

      const result = await verifyEmail('some-token');

      expect(result).toEqual({
        success: false,
        error: 'EXPIRED_TOKEN',
      });
    });

    it('should reject already-used token', async () => {
      const usedToken = {
        ...mockToken,
        usedAt: new Date(),
      };
      mockEmailVerificationRepository.findByTokenHash.mockResolvedValue(usedToken);

      const result = await verifyEmail('some-token');

      expect(result).toEqual({
        success: false,
        error: 'ALREADY_USED',
      });
    });

    it('should reject when user not found', async () => {
      mockEmailVerificationRepository.findByTokenHash.mockResolvedValue(mockToken);
      mockUserRepository.findById.mockResolvedValue(null);

      const result = await verifyEmail('valid-token');

      expect(result).toEqual({
        success: false,
        error: 'USER_NOT_FOUND',
      });
    });

    it('should verify valid token and update user', async () => {
      mockEmailVerificationRepository.findByTokenHash.mockResolvedValue(mockToken);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockEmailVerificationRepository.markUsed.mockResolvedValue(undefined);
      mockUserRepository.updateEmailVerification.mockResolvedValue(undefined);

      const result = await verifyEmail('valid-token');

      expect(result).toEqual({
        success: true,
        userId: testUserId,
        email: testEmail,
      });
      expect(mockEmailVerificationRepository.markUsed).toHaveBeenCalledWith(testTokenId);
      expect(mockUserRepository.updateEmailVerification).toHaveBeenCalledWith(testUserId, true);
    });

    it('should handle email change after token creation', async () => {
      const tokenWithDifferentEmail = {
        ...mockToken,
        email: 'old@example.com',
      };
      const userWithNewEmail = {
        ...mockUser,
        email: 'new@example.com',
      };
      mockEmailVerificationRepository.findByTokenHash.mockResolvedValue(tokenWithDifferentEmail);
      mockUserRepository.findById.mockResolvedValue(userWithNewEmail);
      mockEmailVerificationRepository.markUsed.mockResolvedValue(undefined);
      mockUserRepository.updateEmail.mockResolvedValue(undefined);
      mockUserRepository.updateEmailVerification.mockResolvedValue(undefined);

      const result = await verifyEmail('valid-token');

      expect(result.success).toBe(true);
      expect(result.email).toBe('old@example.com'); // Returns the verified email
      expect(mockUserRepository.updateEmail).toHaveBeenCalledWith(testUserId, 'old@example.com');
    });

    it('should return UNKNOWN_ERROR when verification throws unexpectedly', async () => {
      mockEmailVerificationRepository.findByTokenHash.mockRejectedValue(new Error('db timeout'));

      const result = await verifyEmail('broken-token');

      expect(result).toEqual({
        success: false,
        error: 'UNKNOWN_ERROR',
      });
    });
  });

  describe('resendVerification', () => {
    const mockUser = {
      id: testUserId,
      username: testUsername,
      email: testEmail,
      emailVerified: false,
    };

    it('should reject if user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'User not found',
      });
    });

    it('should reject if no email set', async () => {
      mockUserRepository.findById.mockResolvedValue({ ...mockUser, email: null });

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'No email address set',
      });
    });

    it('should reject if already verified', async () => {
      mockUserRepository.findById.mockResolvedValue({ ...mockUser, emailVerified: true });

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'Email already verified',
      });
    });

    it('should enforce rate limit (max 5 per hour)', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockEmailVerificationRepository.countCreatedSince.mockResolvedValue(5);

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'Too many verification requests. Please try again later.',
      });
    });

    it('should allow resend when under rate limit', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockEmailVerificationRepository.countCreatedSince.mockResolvedValue(4);
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.deleteUnusedByUserId.mockResolvedValue(undefined);
      mockEmailVerificationRepository.create.mockResolvedValue({
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      });
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      const result = await resendVerification(testUserId);

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeDefined();
    });

    it('should return service error message when resend flow throws', async () => {
      mockUserRepository.findById.mockRejectedValue(new Error('lookup failed'));

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'lookup failed',
      });
    });
  });

  describe('isVerificationRequired', () => {
    it('should return true by default', async () => {
      mockSystemSettingRepository.getBoolean.mockResolvedValue(true);

      const result = await isVerificationRequired();

      expect(result).toBe(true);
    });

    it('should return false when disabled in settings', async () => {
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const result = await isVerificationRequired();

      expect(result).toBe(false);
    });
  });

  describe('isEmailVerified', () => {
    it('should return true for verified user', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        emailVerified: true,
      });

      const result = await isEmailVerified(testUserId);

      expect(result).toBe(true);
    });

    it('should return false for unverified user', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        emailVerified: false,
      });

      const result = await isEmailVerified(testUserId);

      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const result = await isEmailVerified(testUserId);

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens and return count', async () => {
      mockEmailVerificationRepository.deleteExpired.mockResolvedValue(5);

      const result = await cleanupExpiredTokens();

      expect(result).toBe(5);
      expect(mockEmailVerificationRepository.deleteExpired).toHaveBeenCalled();
    });

    it('should return 0 when no expired tokens', async () => {
      mockEmailVerificationRepository.deleteExpired.mockResolvedValue(0);

      const result = await cleanupExpiredTokens();

      expect(result).toBe(0);
    });
  });
});
