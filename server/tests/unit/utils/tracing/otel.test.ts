import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

const loadOtel = async () => {
  return import('../../../../src/utils/tracing/otel');
};

describe('initializeOpenTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.OTEL_TRACING_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.NODE_ENV;
  });

  it('returns early when tracing is disabled', async () => {
    process.env.OTEL_TRACING_ENABLED = 'false';
    const { initializeOpenTelemetry } = await loadOtel();

    await initializeOpenTelemetry();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'OpenTelemetry tracing disabled (OTEL_TRACING_ENABLED != true)'
    );
  });

  it('warns when endpoint is missing', async () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    const { initializeOpenTelemetry } = await loadOtel();

    await initializeOpenTelemetry();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'OTEL_TRACING_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT not set'
    );
  });

  it('logs initialization failure when OTEL packages are unavailable', async () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel:4318';
    const { initializeOpenTelemetry } = await loadOtel();

    await initializeOpenTelemetry();

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to initialize OpenTelemetry',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

});
