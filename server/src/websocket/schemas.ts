/**
 * WebSocket Message Zod Schemas
 *
 * Runtime validation for incoming WebSocket messages.
 * These schemas mirror the TypeScript interfaces in shared/types/websocket.ts
 * but provide runtime validation instead of just compile-time type checking.
 */

import { z } from 'zod';

// =============================================================================
// Client Message Schemas
// =============================================================================

export const AuthMessageSchema = z.object({
  type: z.literal('auth'),
  data: z.object({
    token: z.string().min(1),
  }),
});

export const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  data: z.object({
    channel: z.string().min(1),
  }),
});

export const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  data: z.object({
    channel: z.string().min(1),
  }),
});

export const SubscribeBatchMessageSchema = z.object({
  type: z.literal('subscribe_batch'),
  data: z.object({
    channels: z.array(z.string().min(1)),
  }),
});

export const UnsubscribeBatchMessageSchema = z.object({
  type: z.literal('unsubscribe_batch'),
  data: z.object({
    channels: z.array(z.string().min(1)),
  }),
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
});

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
});

/**
 * Union of all valid client message schemas
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  AuthMessageSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  SubscribeBatchMessageSchema,
  UnsubscribeBatchMessageSchema,
  PingMessageSchema,
  PongMessageSchema,
]);

export type ValidatedClientMessage = z.infer<typeof ClientMessageSchema>;

// =============================================================================
// Gateway Message Schemas
// =============================================================================

export const GatewayAuthResponseSchema = z.object({
  type: z.literal('auth_response'),
  response: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid HMAC format'),
});

export const GatewayMessageSchema = z.union([
  GatewayAuthResponseSchema,
  z.object({ type: z.string() }), // Allow other message types after auth
]);

export type ValidatedGatewayMessage = z.infer<typeof GatewayMessageSchema>;

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Parse and validate a WebSocket client message.
 * Returns { success: true, data: ValidatedClientMessage } or { success: false, error: string }
 */
export function parseClientMessage(raw: string):
  | { success: true; data: ValidatedClientMessage }
  | { success: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    const result = ClientMessageSchema.safeParse(parsed);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Format validation errors for logging
    const errorDetails = result.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');

    return { success: false, error: `Validation failed: ${errorDetails}` };
  } catch {
    return { success: false, error: 'Invalid JSON' };
  }
}

/**
 * Parse and validate a gateway message.
 */
export function parseGatewayMessage(raw: string):
  | { success: true; data: ValidatedGatewayMessage }
  | { success: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    const result = GatewayMessageSchema.safeParse(parsed);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errorDetails = result.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');

    return { success: false, error: `Validation failed: ${errorDetails}` };
  } catch {
    return { success: false, error: 'Invalid JSON' };
  }
}
