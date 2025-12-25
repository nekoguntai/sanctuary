-- Add network field to node_configs table
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "network" TEXT NOT NULL DEFAULT 'mainnet';

-- Add network field to electrum_servers table
ALTER TABLE "electrum_servers" ADD COLUMN IF NOT EXISTS "network" TEXT NOT NULL DEFAULT 'mainnet';
