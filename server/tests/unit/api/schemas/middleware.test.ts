import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  validate,
  validateAll,
  validateBody,
  validateParams,
  validateQuery,
} from '../../../../src/api/schemas/middleware';

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

  it('attaches validated query data without mutating req.query', () => {
    const schema = z.object({ page: z.coerce.number().int().min(1) });
    const req: any = { query: { page: '2' } };
    const res = makeRes();
    const next = vi.fn();

    const middleware = validate(schema, 'query');
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query).toEqual({ page: '2' });
    expect(req.validatedQuery).toEqual({ page: 2 });
  });

  it('attaches validated params data for downstream handlers', () => {
    const schema = z.object({ id: z.string().uuid() });
    const req: any = { params: { id: 'b3c1d4f0-1234-5678-9abc-def012345678' } };
    const res = makeRes();
    const next = vi.fn();

    const middleware = validate(schema, 'params');
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.validatedParams).toEqual({
      id: 'b3c1d4f0-1234-5678-9abc-def012345678',
    });
  });

  it('passes unexpected parser exceptions to next', () => {
    const schema: any = {
      safeParse: () => {
        throw new Error('boom');
      },
    };
    const req: any = { body: { any: 'value' } };
    const res = makeRes();
    const next = vi.fn();

    const middleware = validate(schema, 'body');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('supports explicit validation options without changing success behavior', () => {
    const schema = z.object({ enabled: z.boolean() });
    const req: any = { body: { enabled: true, ignored: true } };
    const res = makeRes();
    const next = vi.fn();

    const middleware = validate(schema, 'body', { stripUnknown: false });
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ enabled: true });
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

  it('applies validated data for all targets in validateAll', () => {
    const middleware = validateAll({
      params: z.object({ id: z.string().min(1) }),
      query: z.object({ page: z.coerce.number().int() }),
      body: z.object({ enabled: z.boolean().default(false) }),
    });

    const req: any = {
      params: { id: 'wallet-1' },
      query: { page: '3' },
      body: {},
    };
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ enabled: false });
    expect(req.validatedQuery).toEqual({ page: 3 });
    expect(req.validatedParams).toEqual({ id: 'wallet-1' });
  });

  it('continues when validateAll receives no schemas', () => {
    const middleware = validateAll({});
    const req: any = { body: {}, query: {}, params: {} };
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('validateBody validates and transforms request body', () => {
    const middleware = validateBody(z.object({ count: z.coerce.number().int() }));
    const req: any = { body: { count: '5' } };
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ count: 5 });
  });

  it('validateQuery validates and stores parsed query payload', () => {
    const middleware = validateQuery(z.object({ page: z.coerce.number().int().min(1) }));
    const req: any = { query: { page: '1' } };
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.validatedQuery).toEqual({ page: 1 });
  });

  it('validateParams validates and stores parsed route params', () => {
    const middleware = validateParams(z.object({ id: z.string().min(3) }));
    const req: any = { params: { id: 'abc' } };
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.validatedParams).toEqual({ id: 'abc' });
  });
});
