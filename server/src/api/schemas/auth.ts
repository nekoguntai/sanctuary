/**
 * Auth Validation Schemas
 *
 * Zod schemas for authentication endpoints.
 */

import { z } from 'zod';
import { UsernameSchema, EmailSchema, UuidSchema } from './common';

// =============================================================================
// Password Validation
// =============================================================================

/** Password with strength requirements */
export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine(
    (pwd) => /[a-z]/.test(pwd),
    'Password must contain at least one lowercase letter'
  )
  .refine(
    (pwd) => /[A-Z]/.test(pwd),
    'Password must contain at least one uppercase letter'
  )
  .refine(
    (pwd) => /[0-9]/.test(pwd),
    'Password must contain at least one number'
  );

/** Password for login (no strength requirements, just not empty) */
export const LoginPasswordSchema = z.string().min(1, 'Password is required');

// =============================================================================
// Registration
// =============================================================================

export const RegisterSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  email: EmailSchema.optional(),
});

// =============================================================================
// Login
// =============================================================================

export const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: LoginPasswordSchema,
});

// =============================================================================
// 2FA
// =============================================================================

/** 6-digit TOTP code */
export const TotpCodeSchema = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

/** Backup code (8 alphanumeric chars) */
export const BackupCodeSchema = z.string().regex(/^[A-Z0-9]{8}$/, 'Invalid backup code format');

/** Either TOTP or backup code */
export const TwoFactorCodeSchema = z.string().min(1, 'Code is required');

export const TwoFactorVerifySchema = z.object({
  tempToken: z.string().min(1, 'Temporary token is required'),
  code: TwoFactorCodeSchema,
});

export const TwoFactorEnableSchema = z.object({
  token: TotpCodeSchema,
});

export const TwoFactorDisableSchema = z.object({
  password: LoginPasswordSchema,
  token: TwoFactorCodeSchema,
});

export const BackupCodesRequestSchema = z.object({
  password: LoginPasswordSchema,
});

export const BackupCodesRegenerateSchema = z.object({
  password: LoginPasswordSchema,
  token: TotpCodeSchema,
});

// =============================================================================
// Password Change
// =============================================================================

export const ChangePasswordSchema = z.object({
  currentPassword: LoginPasswordSchema,
  newPassword: PasswordSchema,
});

// =============================================================================
// Token Refresh
// =============================================================================

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
  rotate: z.boolean().optional(),
});

// =============================================================================
// Logout
// =============================================================================

export const LogoutSchema = z.object({
  refreshToken: z.string().optional(),
});

// =============================================================================
// Session Management
// =============================================================================

export const SessionIdParamSchema = z.object({
  id: UuidSchema,
});

// =============================================================================
// User Search
// =============================================================================

export const UserSearchQuerySchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
});

// =============================================================================
// Preferences
// =============================================================================

export const PreferencesSchema = z.object({
  darkMode: z.boolean().optional(),
  theme: z.string().optional(),
  background: z.string().optional(),
  unit: z.enum(['btc', 'sats', 'mbtc']).optional(),
  fiatCurrency: z.string().length(3).toUpperCase().optional(),
  showFiat: z.boolean().optional(),
  priceProvider: z.string().optional(),
  notificationSounds: z.object({
    enabled: z.boolean().optional(),
    volume: z.number().min(0).max(100).optional(),
    confirmation: z.object({
      enabled: z.boolean().optional(),
      sound: z.string().optional(),
    }).optional(),
    receive: z.object({
      enabled: z.boolean().optional(),
      sound: z.string().optional(),
    }).optional(),
    send: z.object({
      enabled: z.boolean().optional(),
      sound: z.string().optional(),
    }).optional(),
  }).optional(),
}).passthrough(); // Allow additional preferences

// =============================================================================
// Telegram
// =============================================================================

export const TelegramChatIdSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
});

export const TelegramTestSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
});

// =============================================================================
// Type Exports
// =============================================================================

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type TwoFactorVerifyInput = z.infer<typeof TwoFactorVerifySchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type PreferencesInput = z.infer<typeof PreferencesSchema>;
