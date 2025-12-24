-- Add SOCKS5 proxy configuration fields to node_configs
ALTER TABLE "node_configs" ADD COLUMN "proxyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "node_configs" ADD COLUMN "proxyHost" TEXT;
ALTER TABLE "node_configs" ADD COLUMN "proxyPort" INTEGER;
ALTER TABLE "node_configs" ADD COLUMN "proxyUsername" TEXT;
ALTER TABLE "node_configs" ADD COLUMN "proxyPassword" TEXT;
