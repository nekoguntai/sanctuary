import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createResourceAccessMiddleware } from '../../../src/middleware/resourceAccess';
import { createMockRequest, createMockResponse, createMockNext } from '../../helpers/testUtils';

describe('createResourceAccessMiddleware', () => {
  const userId = 'test-user-id';
  const user = { userId, username: 'testuser', isAdmin: false };

  const mockCheckView = vi.fn();
  const mockCheckOwner = vi.fn();
  const mockGetRole = vi.fn();
  const mockAttach = vi.fn();

  const requireAccess = createResourceAccessMiddleware({
    resourceName: 'Widget',
    loggerName: 'MW:WIDGET',
    paramNames: ['widgetId', 'id'],
    checks: {
      view: mockCheckView,
      owner: mockCheckOwner,
    },
    getRole: mockGetRole,
    attachToRequest: mockAttach,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when no resource ID in params', async () => {
    const req = createMockRequest({ params: {}, user });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(getResponse().statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when no userId', async () => {
    const req = createMockRequest({ params: { id: 'w1' } });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(getResponse().statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when access denied', async () => {
    mockCheckView.mockResolvedValue(false);
    const req = createMockRequest({ params: { id: 'w1' }, user });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(getResponse().statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and attaches info on success', async () => {
    mockCheckView.mockResolvedValue(true);
    mockGetRole.mockResolvedValue('viewer');
    const req = createMockRequest({ params: { widgetId: 'w1' }, user });
    const { res } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(mockAttach).toHaveBeenCalledWith(req, 'w1', 'viewer');
    expect(next).toHaveBeenCalled();
  });

  it('uses the correct check function per level', async () => {
    mockCheckOwner.mockResolvedValue(true);
    mockGetRole.mockResolvedValue('owner');
    const req = createMockRequest({ params: { id: 'w1' }, user });
    const { res } = createMockResponse();
    const next = createMockNext();

    await requireAccess('owner')(req as any, res as any, next);

    expect(mockCheckOwner).toHaveBeenCalledWith('w1', userId);
    expect(mockCheckView).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('returns 500 on internal error', async () => {
    mockCheckView.mockRejectedValue(new Error('DB down'));
    const req = createMockRequest({ params: { id: 'w1' }, user });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(getResponse().statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('prefers first param name', async () => {
    mockCheckView.mockResolvedValue(true);
    mockGetRole.mockResolvedValue('viewer');
    const req = createMockRequest({ params: { widgetId: 'preferred', id: 'fallback' }, user });
    const { res } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(mockCheckView).toHaveBeenCalledWith('preferred', userId);
  });
});
