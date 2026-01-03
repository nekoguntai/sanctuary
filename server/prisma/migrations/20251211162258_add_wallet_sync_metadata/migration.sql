-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncStatus" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "syncInProgress" BOOLEAN NOT NULL DEFAULT false;
