-- CreateTable
CREATE TABLE "ownership_transfers" (
    "id" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "declineReason" TEXT,
    "keepExistingUsers" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ownership_transfers_fromUserId_status_idx" ON "ownership_transfers"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_toUserId_status_idx" ON "ownership_transfers"("toUserId", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_resourceType_resourceId_status_idx" ON "ownership_transfers"("resourceType", "resourceId", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_status_expiresAt_idx" ON "ownership_transfers"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
