/**
 * Distributed Tracing Types
 *
 * Type definitions for OpenTelemetry integration.
 * Provides consistent interfaces for tracing operations.
 */

/**
 * Span attributes for consistent metadata
 */
export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Span status
 */
export type SpanStatus = 'ok' | 'error' | 'unset';

/**
 * Span context for propagation
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

/**
 * Span options for creating new spans
 */
export interface SpanOptions {
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  attributes?: SpanAttributes;
  parent?: SpanContext;
}

/**
 * Span interface for operations
 */
export interface Span {
  /** Span name */
  name: string;

  /** Span context */
  context: SpanContext;

  /** Set an attribute on the span */
  setAttribute(key: string, value: string | number | boolean): void;

  /** Set multiple attributes */
  setAttributes(attributes: SpanAttributes): void;

  /** Set the span status */
  setStatus(status: SpanStatus, message?: string): void;

  /** Record an exception */
  recordException(error: Error): void;

  /** Add an event to the span */
  addEvent(name: string, attributes?: SpanAttributes): void;

  /** End the span */
  end(): void;
}

/**
 * Tracer interface
 */
export interface Tracer {
  /** Start a new span */
  startSpan(name: string, options?: SpanOptions): Span;

  /** Start an active span (sets as current context) */
  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T
  ): T;

  /** Start an active span with options */
  startActiveSpan<T>(
    name: string,
    options: SpanOptions,
    fn: (span: Span) => T
  ): T;
}

/**
 * Tracer provider interface
 */
export interface TracerProvider {
  /** Get a tracer for a component */
  getTracer(name: string, version?: string): Tracer;

  /** Check if tracing is enabled */
  isEnabled(): boolean;

  /** Shutdown the tracer provider */
  shutdown(): Promise<void>;
}

/**
 * Tracing configuration
 */
export interface TracingConfig {
  /** Enable tracing (default: false in dev, configurable in prod) */
  enabled: boolean;

  /** Service name for identification */
  serviceName: string;

  /** Service version */
  serviceVersion?: string;

  /** Environment (development, staging, production) */
  environment?: string;

  /** OTLP exporter endpoint (e.g., http://localhost:4318) */
  exporterEndpoint?: string;

  /** Export protocol (http, grpc) */
  exporterProtocol?: 'http' | 'grpc';

  /** Sampling ratio (0-1, default 1.0 = 100%) */
  samplingRatio?: number;

  /** Export to console for debugging */
  consoleExporter?: boolean;

  /** Custom resource attributes */
  resourceAttributes?: Record<string, string>;
}

/**
 * HTTP span attributes (semantic conventions)
 */
export interface HttpSpanAttributes extends SpanAttributes {
  'http.method'?: string;
  'http.url'?: string;
  'http.target'?: string;
  'http.host'?: string;
  'http.scheme'?: string;
  'http.status_code'?: number;
  'http.user_agent'?: string;
  'http.request_content_length'?: number;
  'http.response_content_length'?: number;
  'http.route'?: string;
}

/**
 * Database span attributes (semantic conventions)
 */
export interface DbSpanAttributes extends SpanAttributes {
  'db.system'?: string;
  'db.name'?: string;
  'db.statement'?: string;
  'db.operation'?: string;
  'db.sql.table'?: string;
}

/**
 * External service span attributes
 */
export interface ExternalServiceSpanAttributes extends SpanAttributes {
  'peer.service'?: string;
  'peer.hostname'?: string;
  'peer.port'?: number;
  'rpc.method'?: string;
}
