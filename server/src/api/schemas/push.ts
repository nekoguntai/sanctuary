/**
 * Push Notification Validation Schemas
 *
 * Zod schemas for push notification endpoints.
 */

import { z } from 'zod';
import { UuidSchema } from './common';

// =============================================================================
// Platform Types
// =============================================================================

export const PlatformSchema = z.enum(['ios', 'android']);

// =============================================================================
// Device Token Validation
// =============================================================================

/**
 * FCM token validation (Android)
 * FCM tokens are typically 150+ characters, contain letters, numbers, colons, hyphens, underscores
 */
export const FcmTokenSchema = z.string()
  .min(100, 'FCM token appears too short')
  .max(500, 'FCM token appears too long')
  .regex(/^[a-zA-Z0-9:_-]+$/, 'FCM token contains invalid characters');

/**
 * APNs token validation (iOS)
 * APNs device tokens are 64 hex characters or longer for provider tokens
 */
export const ApnsTokenSchema = z.string()
  .min(64, 'APNs token appears too short')
  .max(500, 'APNs token appears too long')
  .refine(
    (token) => /^[a-fA-F0-9]+$/.test(token) || /^[a-zA-Z0-9._-]+$/.test(token),
    'APNs token contains invalid characters'
  );

/**
 * Generic push token (validated based on platform in route handler)
 */
export const PushTokenSchema = z.string()
  .min(64, 'Push token appears too short')
  .max(500, 'Push token appears too long');

// =============================================================================
// Device Registration
// =============================================================================

export const RegisterDeviceSchema = z.object({
  token: PushTokenSchema,
  platform: PlatformSchema,
  deviceName: z.string().max(100).optional(),
});

export const UnregisterDeviceSchema = z.object({
  token: PushTokenSchema,
});

// =============================================================================
// Gateway Audit
// =============================================================================

export const GatewayAuditEventSchema = z.object({
  event: z.string().min(1, 'Event type is required'),
  category: z.enum(['gateway', 'auth', 'security', 'system']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'info']).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  userId: UuidSchema.optional(),
  username: z.string().optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;
export type UnregisterDeviceInput = z.infer<typeof UnregisterDeviceSchema>;
export type GatewayAuditEvent = z.infer<typeof GatewayAuditEventSchema>;
