-- Add connection pooling settings to NodeConfig
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "poolEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "poolMinConnections" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "poolMaxConnections" INTEGER NOT NULL DEFAULT 5;
