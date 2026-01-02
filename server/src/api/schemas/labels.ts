/**
 * Label Validation Schemas
 *
 * Zod schemas for label management endpoints.
 */

import { z } from 'zod';
import { UuidSchema } from './common';

// =============================================================================
// Label Colors
// =============================================================================

/** Valid CSS color values (hex, rgb, hsl, or named colors) */
export const LabelColorSchema = z.string()
  .max(50)
  .refine(
    (color) => {
      // Accept hex colors
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return true;
      // Accept rgb/rgba
      if (/^rgba?\([\d\s,%.]+\)$/.test(color)) return true;
      // Accept hsl/hsla
      if (/^hsla?\([\d\s,%.]+\)$/.test(color)) return true;
      // Accept common named colors
      const namedColors = [
        'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink',
        'gray', 'grey', 'black', 'white', 'brown', 'cyan', 'magenta',
        'teal', 'navy', 'olive', 'maroon', 'aqua', 'lime', 'coral',
        'gold', 'silver', 'indigo', 'violet',
      ];
      return namedColors.includes(color.toLowerCase());
    },
    { message: 'Invalid color format' }
  )
  .optional();

// =============================================================================
// Label CRUD
// =============================================================================

export const CreateLabelSchema = z.object({
  name: z.string().min(1, 'Label name is required').max(100),
  color: LabelColorSchema,
  description: z.string().max(500).optional(),
});

export const UpdateLabelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: LabelColorSchema,
  description: z.string().max(500).optional(),
});

// =============================================================================
// Label Associations
// =============================================================================

/** Array of label IDs for bulk operations */
export const LabelIdsSchema = z.object({
  labelIds: z.array(UuidSchema).min(1, 'At least one label ID is required'),
});

// =============================================================================
// Parameter Schemas
// =============================================================================

export const WalletLabelParamsSchema = z.object({
  walletId: UuidSchema,
});

export const LabelParamsSchema = z.object({
  walletId: UuidSchema,
  labelId: UuidSchema,
});

export const TransactionLabelParamsSchema = z.object({
  transactionId: UuidSchema,
});

export const TransactionLabelIdParamsSchema = z.object({
  transactionId: UuidSchema,
  labelId: UuidSchema,
});

export const AddressLabelParamsSchema = z.object({
  addressId: UuidSchema,
});

export const AddressLabelIdParamsSchema = z.object({
  addressId: UuidSchema,
  labelId: UuidSchema,
});

// =============================================================================
// Type Exports
// =============================================================================

export type CreateLabelInput = z.infer<typeof CreateLabelSchema>;
export type UpdateLabelInput = z.infer<typeof UpdateLabelSchema>;
export type LabelIdsInput = z.infer<typeof LabelIdsSchema>;
