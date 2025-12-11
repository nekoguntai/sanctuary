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

const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  apiUrl: process.env.API_URL || 'http://localhost:3001',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  databaseUrl: process.env.DATABASE_URL || '',

  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

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

// Validation
if (config.nodeEnv === 'production') {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required in production');
  }
  if (config.jwtSecret === 'default-secret-change-in-production') {
    throw new Error('JWT_SECRET must be set in production');
  }
}

export default config;
