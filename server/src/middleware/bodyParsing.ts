import express, { Request, RequestHandler } from 'express';

const DEFAULT_BODY_LIMIT = '10mb';

const largeJsonBodyRoutes = new Set([
  'POST /api/v1/admin/backup/validate',
  'POST /api/v1/admin/restore',
]);

export function usesRouteSpecificLargeJsonParser(req: Pick<Request, 'method' | 'path'>): boolean {
  return largeJsonBodyRoutes.has(`${req.method.toUpperCase()} ${req.path}`);
}

function bypassLargeJsonRoutes(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (usesRouteSpecificLargeJsonParser(req)) {
      next();
      return;
    }

    parser(req, res, next);
  };
}

export function defaultJsonParser(): RequestHandler {
  return bypassLargeJsonRoutes(express.json({ limit: DEFAULT_BODY_LIMIT }));
}

export function defaultUrlencodedParser(): RequestHandler {
  return bypassLargeJsonRoutes(express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}
