-- Add error message column for electrum server health checks
ALTER TABLE "electrum_servers" ADD COLUMN "lastHealthCheckError" TEXT;
