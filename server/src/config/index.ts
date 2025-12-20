/**
 * Server Configuration
 *
 * Centralized configuration management for all environment variables
 * and application settings.
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

interface Config {
  // Server
  nodeEnv: string;
  port: number;
  apiUrl: string;
  clientUrl: string;

  // Database
  databaseUrl: string;

  // JWT
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshExpiresIn: string;

  // Gateway authentication
  gatewaySecret: string;

  // CORS
  corsAllowedOrigins: string[];

  // Bitcoin
  bitcoin: {
    network: 'mainnet' | 'testnet' | 'regtest';
    rpc: {
      host: string;
      port: number;
      user: string;
      password: string;
    };
    electrum: {
      host: string;
      port: number;
      protocol: 'tcp' | 'ssl';
    };
  };

  // Price APIs
  priceApis: {
    mempool: string;
    coingecko: string;
    kraken: string;
  };
}

// Validate JWT_SECRET is set - this is critical for security
// We no longer allow a default secret in ANY environment
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('');
    console.error('================================================================================');
    console.error('FATAL SECURITY ERROR: JWT_SECRET environment variable is not set!');
    console.error('');
    console.error('The JWT_SECRET is required for secure authentication. Without it, tokens');
    console.error('could be forged by attackers, compromising all user accounts.');
    console.error('');
    console.error('To fix this:');
    console.error('  1. Generate a secure random secret (at least 32 characters):');
    console.error('     openssl rand -base64 32');
    console.error('');
    console.error('  2. Set it in your .env file or environment:');
    console.error('     JWT_SECRET=your-generated-secret-here');
    console.error('================================================================================');
    console.error('');
    throw new Error('JWT_SECRET environment variable is required but not set. See error above for instructions.');
  }

  // Warn if the secret appears to be weak
  if (secret.length < 32) {
    console.warn('');
    console.warn('SECURITY WARNING: JWT_SECRET is shorter than 32 characters.');
    console.warn('A longer secret provides better security. Generate one with:');
    console.warn('  openssl rand -base64 32');
    console.warn('');
  }

  return secret;
}

/**
 * Get gateway secret for internal communication
 * Required for HMAC-based authentication between gateway and backend
 */
function getGatewaySecret(): string {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret) {
    console.warn('');
    console.warn('SECURITY WARNING: GATEWAY_SECRET is not set.');
    console.warn('Internal gateway communication will not be authenticated.');
    console.warn('Generate one with: openssl rand -base64 32');
    console.warn('');
    return '';
  }
  if (secret.length < 32) {
    console.warn('');
    console.warn('SECURITY WARNING: GATEWAY_SECRET is shorter than 32 characters.');
    console.warn('A longer secret provides better security.');
    console.warn('');
  }
  return secret;
}

/**
 * Parse CORS allowed origins from environment
 */
function getCorsAllowedOrigins(): string[] {
  const origins = process.env.CORS_ALLOWED_ORIGINS;
  if (!origins) {
    return []; // Empty array means allow all (for mobile apps)
  }
  return origins.split(',').map(o => o.trim()).filter(o => o.length > 0);
}

const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  apiUrl: process.env.API_URL || 'http://localhost:3001',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  databaseUrl: process.env.DATABASE_URL || '',

  jwtSecret: getJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h', // SEC-005: Reduced from 7d to 1h
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  gatewaySecret: getGatewaySecret(),
  corsAllowedOrigins: getCorsAllowedOrigins(),

  bitcoin: {
    network: (process.env.BITCOIN_NETWORK as any) || 'mainnet',
    rpc: {
      host: process.env.BITCOIN_RPC_HOST || 'localhost',
      port: parseInt(process.env.BITCOIN_RPC_PORT || '8332', 10),
      user: process.env.BITCOIN_RPC_USER || '',
      password: process.env.BITCOIN_RPC_PASSWORD || '',
    },
    electrum: {
      host: process.env.ELECTRUM_HOST || 'electrum.blockstream.info',
      port: parseInt(process.env.ELECTRUM_PORT || '50002', 10),
      protocol: (process.env.ELECTRUM_PROTOCOL as any) || 'ssl',
    },
  },

  priceApis: {
    mempool: process.env.MEMPOOL_API || 'https://mempool.space/api/v1',
    coingecko: process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3',
    kraken: process.env.KRAKEN_API || 'https://api.kraken.com/0/public',
  },
};

// Validation for production environment
if (config.nodeEnv === 'production') {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required in production');
  }
  // Note: JWT_SECRET is now validated at startup in getJwtSecret() for ALL environments
}

export default config;
