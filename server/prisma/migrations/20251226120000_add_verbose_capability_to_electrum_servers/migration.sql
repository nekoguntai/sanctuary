-- AlterTable
ALTER TABLE "electrum_servers" ADD COLUMN "supportsVerbose" BOOLEAN;
ALTER TABLE "electrum_servers" ADD COLUMN "lastCapabilityCheck" TIMESTAMP(3);
