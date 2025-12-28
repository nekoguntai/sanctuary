/**
 * Configuration Type Definitions
 *
 * Centralized types for all application configuration.
 */

export type NetworkType = 'mainnet' | 'testnet' | 'signet' | 'regtest';
export type ElectrumProtocol = 'tcp' | 'ssl';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  apiUrl: string;
  clientUrl: string;
}

export interface DatabaseConfig {
  url: string;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshExpiresIn: string;
}

export interface SecurityConfig {
  jwt: JwtConfig;
  gatewaySecret: string;
  corsAllowedOrigins: string[];
  encryptionKey: string;
  encryptionSalt: string;
}

export interface RateLimitConfig {
  loginAttempts: number;
  passwordChangeAttempts: number;
}

export interface BitcoinRpcConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface ElectrumConfig {
  host: string;
  port: number;
  protocol: ElectrumProtocol;
}

export interface BitcoinConfig {
  network: NetworkType;
  rpc: BitcoinRpcConfig;
  electrum: ElectrumConfig;
}

export interface PriceApisConfig {
  mempool: string;
  coingecko: string;
  kraken: string;
}

export interface AiConfig {
  containerUrl: string;
  configSecret: string;
}

export interface MaintenanceConfig {
  auditLogRetentionDays: number;
  priceDataRetentionDays: number;
  feeEstimateRetentionDays: number;
  diskWarningThresholdPercent: number;
}

export interface WebSocketConfig {
  maxConnections: number;
  maxPerUser: number;
}

export interface PushNotificationConfig {
  fcm: {
    serviceAccountPath: string;
  };
  apns: {
    keyId: string;
    teamId: string;
    keyPath: string;
    bundleId: string;
    isProduction: boolean;
  };
}

export interface DockerConfig {
  proxyUrl: string;
}

export interface LoggingConfig {
  level: LogLevel;
}

/**
 * Experimental features that may change or be removed
 */
export interface ExperimentalFeatures {
  taprootAddresses: boolean;
  silentPayments: boolean;
  coinJoin: boolean;
}

/**
 * Feature flags for runtime feature toggling
 *
 * Categories:
 * - Core: Essential wallet functionality
 * - Integration: External service integrations
 * - Experimental: Unstable features for testing
 */
export interface FeatureFlags {
  // Core wallet features
  hardwareWalletSigning: boolean;
  qrCodeSigning: boolean;
  multisigWallets: boolean;
  batchSync: boolean;

  // Transaction features
  payjoinSupport: boolean;
  batchTransactions: boolean;
  rbfTransactions: boolean;

  // Integration features
  priceAlerts: boolean;
  aiAssistant: boolean;
  telegramNotifications: boolean;

  // Protocol features
  websocketV2Events: boolean;

  // Experimental (nested for clarity)
  experimental: ExperimentalFeatures;
}

/**
 * Feature flag key type for middleware
 */
export type FeatureFlagKey = keyof Omit<FeatureFlags, 'experimental'> | `experimental.${keyof ExperimentalFeatures}`;

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  security: SecurityConfig;
  rateLimit: RateLimitConfig;
  bitcoin: BitcoinConfig;
  priceApis: PriceApisConfig;
  ai: AiConfig;
  maintenance: MaintenanceConfig;
  websocket: WebSocketConfig;
  push: PushNotificationConfig;
  docker: DockerConfig;
  logging: LoggingConfig;
  features: FeatureFlags;
}

/**
 * Legacy flat config interface for backward compatibility
 * @deprecated Use AppConfig with nested structure for new code
 */
export interface LegacyConfig {
  // Server (flat)
  nodeEnv: string;
  port: number;
  apiUrl: string;
  clientUrl: string;

  // Database
  databaseUrl: string;

  // JWT (flat)
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshExpiresIn: string;

  // Gateway
  gatewaySecret: string;

  // CORS
  corsAllowedOrigins: string[];

  // Bitcoin (nested - unchanged)
  bitcoin: BitcoinConfig;

  // Price APIs (nested - unchanged)
  priceApis: PriceApisConfig;
}

/**
 * Combined config that includes both new nested and legacy flat properties
 */
export type CombinedConfig = AppConfig & LegacyConfig;
