-- Add load balancing strategy to node_configs
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "poolLoadBalancing" TEXT NOT NULL DEFAULT 'round_robin';

-- Create electrum_servers table for multi-server pool support
CREATE TABLE IF NOT EXISTS "electrum_servers" (
    "id" TEXT NOT NULL,
    "nodeConfigId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "useSsl" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHealthCheck" TIMESTAMP(3),
    "healthCheckFails" INTEGER NOT NULL DEFAULT 0,
    "isHealthy" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "electrum_servers_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "electrum_servers_nodeConfigId_idx" ON "electrum_servers"("nodeConfigId");
CREATE INDEX IF NOT EXISTS "electrum_servers_priority_idx" ON "electrum_servers"("priority");

-- Add foreign key constraint
ALTER TABLE "electrum_servers" ADD CONSTRAINT "electrum_servers_nodeConfigId_fkey"
    FOREIGN KEY ("nodeConfigId") REFERENCES "node_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing node config to electrum_servers table
-- This creates a server entry from the existing host/port/useSsl in node_configs
INSERT INTO "electrum_servers" ("id", "nodeConfigId", "label", "host", "port", "useSsl", "priority", "enabled", "isHealthy", "updatedAt")
SELECT
    gen_random_uuid()::text,
    nc.id,
    CASE
        WHEN nc.host LIKE '%blockstream%' THEN 'Blockstream'
        WHEN nc.host LIKE '%mempool%' THEN 'mempool.space'
        ELSE nc.host
    END,
    nc.host,
    nc.port,
    nc."useSsl",
    0,
    true,
    true,
    NOW()
FROM "node_configs" nc
WHERE nc.type = 'electrum'
AND NOT EXISTS (
    SELECT 1 FROM "electrum_servers" es WHERE es."nodeConfigId" = nc.id
);
