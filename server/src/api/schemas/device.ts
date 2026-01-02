/**
 * Device Validation Schemas
 *
 * Zod schemas for hardware device endpoints.
 */

import { z } from 'zod';
import { UuidSchema, XpubSchema, DerivationPathSchema, FingerprintSchema } from './common';

// =============================================================================
// Device Types
// =============================================================================

export const DeviceTypeSchema = z.string().min(1, 'Device type is required');

// =============================================================================
// Device Creation
// =============================================================================

export const CreateDeviceSchema = z.object({
  type: DeviceTypeSchema,
  label: z.string().min(1, 'Device label is required').max(100),
  fingerprint: FingerprintSchema,
  xpub: XpubSchema,
  derivationPath: DerivationPathSchema.optional(),
  modelSlug: z.string().optional(),
});

// =============================================================================
// Device Update
// =============================================================================

export const UpdateDeviceSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  derivationPath: DerivationPathSchema.optional(),
  type: DeviceTypeSchema.optional(),
  modelSlug: z.string().optional(),
});

// =============================================================================
// Device Sharing
// =============================================================================

export const ShareDeviceWithUserSchema = z.object({
  targetUserId: UuidSchema,
});

export const ShareDeviceWithGroupSchema = z.object({
  groupId: UuidSchema.nullable(),
});

// =============================================================================
// Device Model Filters
// =============================================================================

export const DeviceModelFilterSchema = z.object({
  manufacturer: z.string().optional(),
  airGapped: z.coerce.boolean().optional(),
  connectivity: z.string().optional(),
  showDiscontinued: z.coerce.boolean().optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type CreateDeviceInput = z.infer<typeof CreateDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;
export type DeviceModelFilter = z.infer<typeof DeviceModelFilterSchema>;
