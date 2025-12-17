-- Add mempoolEstimator column to node_configs table
-- Options: 'simple' (fee bucket algorithm), 'mempool_space' (uses mempool.space projected blocks API)
ALTER TABLE "node_configs" ADD COLUMN "mempoolEstimator" TEXT NOT NULL DEFAULT 'mempool_space';
