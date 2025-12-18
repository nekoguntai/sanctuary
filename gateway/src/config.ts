/**
 * Gateway Configuration
 *
 * All configuration is loaded from environment variables.
 * This module exports a typed config object for use throughout the gateway.
 *
 * ## Required Environment Variables
 *
 * - `JWT_SECRET` - Must match the backend's JWT secret for token validation
 *
 * ## Optional Environment Variables
 *
 * ### Server
 * - `GATEWAY_PORT` - Port to listen on (default: 4000)
 * - `NODE_ENV` - Environment mode (default: development)
 *
 * ### Backend Connection
 * - `BACKEND_URL` - Backend HTTP URL (default: http://backend:3000)
 * - `BACKEND_WS_URL` - Backend WebSocket URL (default: ws://backend:3000)
 *
 * ### Rate Limiting
 * - `RATE_LIMIT_WINDOW_MS` - Time window in ms (default: 60000)
 * - `RATE_LIMIT_MAX` - Max requests per window (default: 60)
 *
 * ### Push Notifications
 * See FCM and APNs sections below for service-specific config.
 */

export const config = {
  // Server
  port: parseInt(process.env.GATEWAY_PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Backend connection (internal network)
  backendUrl: process.env.BACKEND_URL || 'http://backend:3000',
  backendWsUrl: process.env.BACKEND_WS_URL || 'ws://backend:3000',

  // JWT (must match backend)
  jwtSecret: process.env.JWT_SECRET || '',

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '60', 10), // 60 requests per minute
  },

  // Firebase Cloud Messaging (Android)
  // To enable: Create a Firebase project, download the service account JSON,
  // and either mount it at /app/config/fcm-service-account.json or set these env vars.
  fcm: {
    projectId: process.env.FCM_PROJECT_ID || '',
    privateKey: process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n') || '',
    clientEmail: process.env.FCM_CLIENT_EMAIL || '',
  },

  // Apple Push Notification Service (iOS)
  // To enable: Create an APNs key in Apple Developer portal, download the .p8 file,
  // and mount it at /app/config/apns-key.p8. Set the key ID, team ID, and bundle ID.
  apns: {
    keyId: process.env.APNS_KEY_ID || '',
    teamId: process.env.APNS_TEAM_ID || '',
    privateKey: process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n') || '',
    bundleId: process.env.APNS_BUNDLE_ID || 'com.sanctuary.app',
    production: process.env.NODE_ENV === 'production',
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate required config
export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.jwtSecret) {
    errors.push('JWT_SECRET is required');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }
}
