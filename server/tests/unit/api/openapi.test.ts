import openApiRouter, { openApiSpec } from '../../../src/api/openapi';

type HandlerResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body?: unknown;
};

const invokeRoute = (method: string, url: string) => new Promise<HandlerResponse>((resolve, reject) => {
  const req = { method, url } as any;
  const res: any = {
    statusCode: 200,
    headers: {},
    setHeader: (key: string, value: string) => {
      res.headers[key.toLowerCase()] = value;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    send: (body?: unknown) => {
      res.body = body;
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res.body });
    },
    json: (body: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.body = body;
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res.body });
    },
  };

  openApiRouter.handle(req, res, (err?: Error) => {
    if (err) {
      reject(err);
      return;
    }
    reject(new Error(`Route not handled: ${method} ${url}`));
  });
});

describe('OpenAPI Docs', () => {
  it('serves Swagger UI html', async () => {
    const response = await invokeRoute('GET', '/');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(String(response.body)).toContain('swagger-ui-bundle.js');
    expect(String(response.body)).toContain('/api/v1/docs/openapi.json');
  });

  it('serves OpenAPI spec json', async () => {
    const response = await invokeRoute('GET', '/openapi.json');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const body = response.body as { openapi?: string; info?: { title?: string } };
    expect(body.openapi).toBe('3.0.3');
    expect(body.info?.title).toBe('Sanctuary API');
  });

  it('exports spec with core paths', () => {
    expect(openApiSpec.paths['/auth/login']).toBeDefined();
    expect(openApiSpec.paths['/wallets']).toBeDefined();
  });
});
