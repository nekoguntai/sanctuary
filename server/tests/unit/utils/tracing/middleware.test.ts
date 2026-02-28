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

vi.unmock('../../../../src/utils/requestContext');

import { requestContext } from '../../../../src/utils/requestContext';
import { configureTracing } from '../../../../src/utils/tracing/tracer';
import {
  addSpanAttribute,
  addSpanEvent,
  getCurrentSpan,
  tracingMiddleware,
} from '../../../../src/utils/tracing/middleware';

const createRequest = (overrides: Record<string, unknown> = {}) => {
  const headers: Record<string, string> = {
    host: 'localhost',
    'user-agent': 'vitest-agent',
    'content-length': '42',
    authorization: 'Bearer secret',
    'x-custom-header': 'allowed',
  };
  const req: any = {
    method: 'GET',
    path: '/api/wallets/123',
    originalUrl: '/api/wallets/123?foo=1',
    hostname: 'localhost',
    protocol: 'http',
    route: { path: '/api/wallets/:id' },
    headers,
    get: (name: string) => headers[name.toLowerCase()],
    ...overrides,
  };
  return req;
};

const createResponse = (statusCode = 200) => {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const res: any = {
    statusCode,
    _headers: {} as Record<string, string>,
    get: (name: string) => res._headers[name.toLowerCase()],
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      const list = listeners.get(event) || [];
      list.push(fn);
      listeners.set(event, list);
      return res;
    }),
    emit: (event: string, ...args: any[]) => {
      for (const fn of listeners.get(event) || []) {
        fn(...args);
      }
    },
    end: vi.fn(function end() {
      return res;
    }),
  };
  return res;
};

describe('tracingMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureTracing({ enabled: false });
  });

  it('skips middleware when tracing is disabled', () => {
    const mw = tracingMiddleware();
    const req = createRequest();
    const res = createResponse();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getCurrentSpan(req)).toBeUndefined();
  });

  it('skips ignored paths', () => {
    configureTracing({ enabled: true });
    const mw = tracingMiddleware();
    const req = createRequest({ path: '/health', originalUrl: '/health' });
    const res = createResponse();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getCurrentSpan(req)).toBeUndefined();
  });

  it('creates span, sets context, and captures response attributes', () => {
    configureTracing({ enabled: true });
    const mw = tracingMiddleware({
      includeHeaders: true,
      extractAttributes: () => ({ 'feature.enabled': true }),
    });
    const req = createRequest({
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      headers: {
        host: 'localhost',
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        'user-agent': 'vitest-agent',
        'content-length': '42',
        authorization: 'Bearer secret',
        'x-custom-header': 'allowed',
      },
    });
    const res = createResponse(201);
    res._headers['content-length'] = '128';
    const next = vi.fn();

    requestContext.run(
      {
        requestId: 'req-abc',
        startTime: Date.now(),
        userId: 'user-123',
      },
      () => {
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);

        const span = getCurrentSpan(req);
        expect(span).toBeDefined();
        expect(span?.context.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(requestContext.getTraceId()).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

        addSpanAttribute(req, 'custom.attr', 'ok');
        addSpanEvent(req, 'custom.event', { k: 'v' });

        res.end();
      }
    );

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Span ended: sanctuary.GET /api/wallets/:id',
      expect.objectContaining({
        status: 'ok',
        'http.status_code': 201,
        'http.response_content_length': 128,
        'http.request.header.x-custom-header': 'allowed',
        'feature.enabled': true,
        'user.id': 'user-123',
        'custom.attr': 'ok',
      })
    );
    const loggedPayload = mockLogger.debug.mock.calls[0][1];
    expect(loggedPayload['http.request.header.authorization']).toBeUndefined();
  });

  it('marks span as error for 4xx/5xx responses', () => {
    configureTracing({ enabled: true });
    const mw = tracingMiddleware();
    const req = createRequest();
    const res = createResponse(404);

    requestContext.run(
      {
        requestId: 'req-404',
        startTime: Date.now(),
      },
      () => {
        mw(req, res, vi.fn());
        res.end();
      }
    );

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Span ended: sanctuary.GET /api/wallets/:id',
      expect.objectContaining({
        status: 'error',
        statusMessage: 'HTTP 404',
      })
    );
  });

  it('records response stream errors on span', () => {
    configureTracing({ enabled: true });
    const mw = tracingMiddleware();
    const req = createRequest();
    const res = createResponse(200);

    requestContext.run(
      {
        requestId: 'req-error',
        startTime: Date.now(),
      },
      () => {
        mw(req, res, vi.fn());
        res.emit('error', new Error('socket failure'));
        res.end();
      }
    );

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Span ended: sanctuary.GET /api/wallets/:id',
      expect.objectContaining({
        error: 'socket failure',
      })
    );
  });

  it('no-ops addSpan helpers when no span exists', () => {
    const req = createRequest();

    expect(getCurrentSpan(req)).toBeUndefined();
    expect(() => addSpanAttribute(req, 'key', 'value')).not.toThrow();
    expect(() => addSpanEvent(req, 'evt', { x: '1' })).not.toThrow();
  });
});
