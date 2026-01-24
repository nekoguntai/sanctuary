import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate, validateAll } from '../../../../src/api/schemas/middleware';

const makeRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('Validation middleware', () => {
  it('validates body and attaches parsed data', () => {
    const schema = z.object({ name: z.string().min(1) });
    const req: any = { body: { name: 'Alice' } };
    const res = makeRes();
    const next = vi.fn();

    const middleware = validate(schema, 'body');
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Alice');
  });

  it('returns 400 on validation error', () => {
    const schema = z.object({ name: z.string().min(1) });
    const req: any = { body: { name: '' } };
    const res = makeRes();
    const next = vi.fn();

    const middleware = validate(schema, 'body');
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('validates multiple targets with validateAll', () => {
    const middleware = validateAll({
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ enabled: z.boolean() }),
    });

    const req: any = {
      params: { id: 'b3c1d4f0-1234-5678-9abc-def012345678' },
      body: { enabled: true },
    };
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns aggregated errors for validateAll', () => {
    const middleware = validateAll({
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ page: z.coerce.number().int().min(1) }),
    });

    const req: any = {
      params: { id: 'not-uuid' },
      query: { page: '0' },
    };
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
