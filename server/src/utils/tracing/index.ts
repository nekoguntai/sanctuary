/**
 * Distributed Tracing Module
 *
 * OpenTelemetry-compatible distributed tracing for request correlation
 * and performance monitoring across the application.
 *
 * ## Features
 *
 * - Automatic HTTP request tracing via middleware
 * - Database query tracing utilities
 * - External service call tracing
 * - Span propagation for distributed systems
 * - Fallback implementation when OpenTelemetry is not installed
 *
 * ## Quick Start
 *
 * ```typescript
 * import { tracingMiddleware, withSpan, startSpan } from './utils/tracing';
 *
 * // Add middleware to Express app
 * app.use(tracingMiddleware());
 *
 * // Manual tracing
 * const result = await withSpan('fetchUserData', async (span) => {
 *   span.setAttribute('userId', userId);
 *   return await userService.findById(userId);
 * });
 *
 * // Low-level span control
 * const span = startSpan('customOperation');
 * try {
 *   // do work
 *   span.setStatus('ok');
 * } catch (error) {
 *   span.recordException(error);
 * } finally {
 *   span.end();
 * }
 * ```
 *
 * ## Enabling OpenTelemetry
 *
 * Install OpenTelemetry packages:
 * ```
 * npm install @opentelemetry/api @opentelemetry/sdk-node
 * ```
 *
 * Set environment variables:
 * ```
 * OTEL_TRACING_ENABLED=true
 * OTEL_SERVICE_NAME=sanctuary-api
 * OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 * ```
 */

// Core tracing
export {
  configureTracing,
  getTracer,
  getTracerProvider,
  setTracerProvider,
  startSpan,
  withSpan,
  traced,
  getTraceHeaders,
  parseTraceContext,
} from './tracer';

// HTTP middleware
export {
  tracingMiddleware,
  getCurrentSpan,
  addSpanAttribute,
  addSpanEvent,
  type TracingMiddlewareOptions,
} from './middleware';

// Types
export type {
  Span,
  SpanAttributes,
  SpanContext,
  SpanOptions,
  SpanStatus,
  Tracer,
  TracerProvider,
  TracingConfig,
  HttpSpanAttributes,
  DbSpanAttributes,
  ExternalServiceSpanAttributes,
} from './types';

// =============================================================================
// Convenience Decorators for Services
// =============================================================================

import { withSpan } from './tracer';
import type { DbSpanAttributes, ExternalServiceSpanAttributes } from './types';

/**
 * Trace a database operation
 */
export async function traceDbOperation<T>(
  operation: string,
  table: string,
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(`db.${operation}`, async (span) => {
    const attributes: DbSpanAttributes = {
      'db.system': 'postgresql',
      'db.operation': operation,
      'db.sql.table': table,
    };
    span.setAttributes(attributes);
    return fn();
  }) as Promise<T>;
}

/**
 * Trace an external service call
 */
export async function traceExternalCall<T>(
  service: string,
  method: string,
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(`external.${service}.${method}`, async (span) => {
    const attributes: ExternalServiceSpanAttributes = {
      'peer.service': service,
      'rpc.method': method,
    };
    span.setAttributes(attributes);
    return fn();
  }) as Promise<T>;
}

/**
 * Trace a cache operation
 */
export async function traceCacheOperation<T>(
  operation: 'get' | 'set' | 'delete',
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(`cache.${operation}`, async (span) => {
    span.setAttribute('cache.operation', operation);
    span.setAttribute('cache.key', key);
    return fn();
  }) as Promise<T>;
}
