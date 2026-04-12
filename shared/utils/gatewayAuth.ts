import { createHash, createHmac } from 'crypto';

/**
 * SEC-002 gateway request signature fields.
 */
export interface GatewaySignature {
  signature: string;
  timestamp: string;
}

function isEmptyPlainObject(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(body);
  return (prototype === Object.prototype || prototype === null)
    && Object.keys(body).length === 0;
}

/**
 * Hash a parsed request body for gateway HMAC signing.
 *
 * Empty JSON objects are treated the same as no body to preserve the existing
 * GET/DELETE signing contract. Arrays, buffers, and non-plain objects are
 * hashed distinctly so they cannot collapse to the empty-body signature.
 */
export function hashGatewayBody(body: unknown): string {
  if (body == null || isEmptyPlainObject(body)) {
    return '';
  }

  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return createHash('sha256').update(bodyStr).digest('hex');
}

/**
 * Create the SEC-002 HMAC over method + path + timestamp + bodyHash.
 */
export function createGatewaySignature(
  method: string,
  path: string,
  timestamp: string,
  bodyHash: string,
  secret: string
): string {
  const message = `${method.toUpperCase()}${path}${timestamp}${bodyHash}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Generate gateway HMAC headers for a backend internal request.
 */
export function generateGatewaySignature(
  method: string,
  path: string,
  body: unknown,
  secret: string,
  timestamp: string = Date.now().toString()
): GatewaySignature {
  const bodyHash = hashGatewayBody(body);
  const signature = createGatewaySignature(method, path, timestamp, bodyHash, secret);
  return { signature, timestamp };
}
