/**
 * API Versioning Middleware
 *
 * Provides REST API versioning through multiple mechanisms:
 * - Accept header: Accept: application/vnd.sanctuary.v2+json
 * - X-API-Version header: X-API-Version: 2
 * - Query parameter: ?api_version=2
 *
 * ## Version Precedence (highest to lowest)
 * 1. Accept header (most specific)
 * 2. X-API-Version header
 * 3. Query parameter
 * 4. URL path version (/api/v1/... -> 1)
 * 5. Default version
 *
 * ## Usage
 *
 * ```typescript
 * // Global middleware
 * app.use(apiVersionMiddleware());
 *
 * // In route handlers
 * app.get('/api/v1/resource', (req, res) => {
 *   const version = req.apiVersion; // { major: 1, minor: 0 }
 *   if (version.major >= 2) {
 *     // New behavior
 *   }
 * });
 *
 * // Version-specific routes
 * router.get('/resource', requireApiVersion(2), newHandler);
 * router.get('/resource', newHandler); // All versions
 * ```
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('ApiVersion');

// =============================================================================
// Types
// =============================================================================

export interface ApiVersion {
  major: number;
  minor: number;
}

export interface ApiVersionConfig {
  /** Default version when none specified (default: 1) */
  defaultVersion?: number;
  /** Current/latest version (default: 1) */
  currentVersion?: number;
  /** Minimum supported version (default: 1) */
  minVersion?: number;
  /** Deprecated versions that trigger warnings (default: []) */
  deprecatedVersions?: number[];
  /** Sunset versions that will be removed soon (default: []) */
  sunsetVersions?: { version: number; date: string }[];
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      apiVersion: ApiVersion;
    }
  }
}

// =============================================================================
// Constants
// =============================================================================

const ACCEPT_HEADER_REGEX = /application\/vnd\.sanctuary\.v(\d+)(?:\.(\d+))?(?:\+json)?/i;
const DEFAULT_CONFIG: Required<ApiVersionConfig> = {
  defaultVersion: 1,
  currentVersion: 1,
  minVersion: 1,
  deprecatedVersions: [],
  sunsetVersions: [],
};

// =============================================================================
// Version Parsing
// =============================================================================

/**
 * Parse version from Accept header
 * Format: application/vnd.sanctuary.v{major}[.{minor}][+json]
 */
function parseAcceptHeader(header: string | undefined): ApiVersion | null {
  if (!header) return null;

  const match = header.match(ACCEPT_HEADER_REGEX);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: match[2] ? parseInt(match[2], 10) : 0,
  };
}

/**
 * Parse version from X-API-Version header
 * Format: {major}[.{minor}]
 */
function parseVersionHeader(header: string | undefined): ApiVersion | null {
  if (!header) return null;

  const parts = header.split('.');
  const major = parseInt(parts[0], 10);
  if (isNaN(major)) return null;

  return {
    major,
    minor: parts[1] ? parseInt(parts[1], 10) : 0,
  };
}

/**
 * Parse version from URL path
 * Format: /api/v{major}/...
 */
function parseUrlVersion(path: string): ApiVersion | null {
  const match = path.match(/\/api\/v(\d+)\//);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: 0,
  };
}

/**
 * Parse version from query parameter
 * Format: ?api_version={major}[.{minor}]
 */
function parseQueryVersion(query: string | undefined): ApiVersion | null {
  if (!query) return null;

  const parts = query.split('.');
  const major = parseInt(parts[0], 10);
  if (isNaN(major)) return null;

  return {
    major,
    minor: parts[1] ? parseInt(parts[1], 10) : 0,
  };
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * API versioning middleware
 *
 * Determines the API version from request and attaches it to req.apiVersion
 */
export function apiVersionMiddleware(
  userConfig: ApiVersionConfig = {}
): RequestHandler {
  const config = { ...DEFAULT_CONFIG, ...userConfig };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Try each version source in precedence order
    let version: ApiVersion | null = null;
    let source = 'default';

    // 1. Accept header (highest precedence)
    version = parseAcceptHeader(req.headers.accept);
    if (version) source = 'accept-header';

    // 2. X-API-Version header
    if (!version) {
      version = parseVersionHeader(req.headers['x-api-version'] as string);
      if (version) source = 'x-api-version';
    }

    // 3. Query parameter
    if (!version) {
      version = parseQueryVersion(req.query.api_version as string);
      if (version) source = 'query';
    }

    // 4. URL path version
    if (!version) {
      version = parseUrlVersion(req.path);
      if (version) source = 'url-path';
    }

    // 5. Default version
    if (!version) {
      version = { major: config.defaultVersion, minor: 0 };
    }

    // Validate version range
    if (version.major < config.minVersion) {
      res.status(400).json({
        error: 'Unsupported API Version',
        message: `API version ${version.major} is no longer supported. Minimum version is ${config.minVersion}.`,
        minVersion: config.minVersion,
        currentVersion: config.currentVersion,
      });
      return;
    }

    if (version.major > config.currentVersion) {
      res.status(400).json({
        error: 'Unknown API Version',
        message: `API version ${version.major} does not exist. Current version is ${config.currentVersion}.`,
        currentVersion: config.currentVersion,
      });
      return;
    }

    // Set response headers
    res.setHeader('X-API-Version', `${version.major}.${version.minor}`);
    res.setHeader('X-API-Current-Version', config.currentVersion.toString());

    // Check for deprecation
    if (config.deprecatedVersions.includes(version.major)) {
      res.setHeader('X-API-Deprecated', 'true');
      res.setHeader(
        'Warning',
        `299 - "API version ${version.major} is deprecated. Please upgrade to version ${config.currentVersion}."`
      );
      log.warn('Deprecated API version used', {
        version: version.major,
        path: req.path,
        source,
      });
    }

    // Check for sunset
    const sunsetInfo = config.sunsetVersions.find((s) => s.version === version!.major);
    if (sunsetInfo) {
      res.setHeader('Sunset', new Date(sunsetInfo.date).toUTCString());
      res.setHeader(
        'Warning',
        `299 - "API version ${version.major} will be removed on ${sunsetInfo.date}. Please upgrade to version ${config.currentVersion}."`
      );
    }

    // Attach version to request
    req.apiVersion = version;

    log.debug('API version resolved', {
      version: `${version.major}.${version.minor}`,
      source,
      path: req.path,
    });

    next();
  };
}

/**
 * Middleware to require a minimum API version
 */
export function requireApiVersion(minMajor: number, minMinor = 0): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { major, minor } = req.apiVersion;

    if (major < minMajor || (major === minMajor && minor < minMinor)) {
      res.status(400).json({
        error: 'API Version Too Low',
        message: `This endpoint requires API version ${minMajor}.${minMinor} or higher. You requested version ${major}.${minor}.`,
        requiredVersion: `${minMajor}.${minMinor}`,
        requestedVersion: `${major}.${minor}`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to limit endpoint to a maximum API version
 * Useful for endpoints being removed in newer versions
 */
export function maxApiVersion(maxMajor: number, maxMinor = 999): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { major, minor } = req.apiVersion;

    if (major > maxMajor || (major === maxMajor && minor > maxMinor)) {
      res.status(410).json({
        error: 'Endpoint Removed',
        message: `This endpoint was removed in API version ${maxMajor + 1}. Please use the new endpoint.`,
        removedInVersion: maxMajor + 1,
        requestedVersion: `${major}.${minor}`,
      });
      return;
    }

    next();
  };
}

/**
 * Helper to check API version in route handlers
 */
export function isApiVersion(req: Request, major: number, minor = 0): boolean {
  return req.apiVersion.major === major && req.apiVersion.minor >= minor;
}

/**
 * Helper to check if API version is at least the specified version
 */
export function isApiVersionAtLeast(req: Request, major: number, minor = 0): boolean {
  const { major: reqMajor, minor: reqMinor } = req.apiVersion;
  return reqMajor > major || (reqMajor === major && reqMinor >= minor);
}

export default apiVersionMiddleware;
