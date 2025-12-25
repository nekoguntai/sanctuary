-- Remove Bitcoin RPC support - Electrum only
-- This migration removes username/password fields and adds per-network configuration

-- Remove RPC credential fields from NodeConfig
ALTER TABLE "node_configs" DROP COLUMN IF EXISTS "username";
ALTER TABLE "node_configs" DROP COLUMN IF EXISTS "password";

-- Update existing type values to 'electrum' (in case any are 'bitcoin_core' or 'bitcoind')
UPDATE "node_configs" SET "type" = 'electrum' WHERE "type" != 'electrum';

-- ========================================
-- MAINNET SETTINGS
-- ========================================
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "mainnetMode" TEXT DEFAULT 'pool';
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "mainnetSingletonHost" TEXT;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "mainnetSingletonPort" INTEGER;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "mainnetSingletonSsl" BOOLEAN DEFAULT true;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "mainnetPoolMin" INTEGER DEFAULT 1;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "mainnetPoolMax" INTEGER DEFAULT 5;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "mainnetPoolLoadBalancing" TEXT DEFAULT 'round_robin';

-- ========================================
-- TESTNET SETTINGS
-- ========================================
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetEnabled" BOOLEAN DEFAULT false;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetMode" TEXT DEFAULT 'singleton';
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetSingletonHost" TEXT;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetSingletonPort" INTEGER;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetSingletonSsl" BOOLEAN DEFAULT true;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetPoolMin" INTEGER DEFAULT 1;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetPoolMax" INTEGER DEFAULT 3;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnetPoolLoadBalancing" TEXT DEFAULT 'round_robin';

-- ========================================
-- SIGNET SETTINGS
-- ========================================
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetEnabled" BOOLEAN DEFAULT false;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetMode" TEXT DEFAULT 'singleton';
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetSingletonHost" TEXT;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetSingletonPort" INTEGER;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetSingletonSsl" BOOLEAN DEFAULT true;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetPoolMin" INTEGER DEFAULT 1;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetPoolMax" INTEGER DEFAULT 3;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "signetPoolLoadBalancing" TEXT DEFAULT 'round_robin';

-- ========================================
-- MIGRATE EXISTING CONFIG TO NEW STRUCTURE
-- ========================================
-- Copy legacy values to mainnet settings
UPDATE "node_configs" SET
  "mainnetMode" = CASE WHEN "poolEnabled" = true THEN 'pool' ELSE 'singleton' END,
  "mainnetSingletonHost" = "host",
  "mainnetSingletonPort" = "port",
  "mainnetSingletonSsl" = "useSsl",
  "mainnetPoolMin" = "poolMinConnections",
  "mainnetPoolMax" = "poolMaxConnections",
  "mainnetPoolLoadBalancing" = "poolLoadBalancing"
WHERE "mainnetSingletonHost" IS NULL;
