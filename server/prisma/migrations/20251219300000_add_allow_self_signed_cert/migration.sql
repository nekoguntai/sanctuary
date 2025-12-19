-- AlterTable
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "allowSelfSignedCert" BOOLEAN NOT NULL DEFAULT false;
