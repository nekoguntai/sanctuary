-- CreateTable
CREATE TABLE "mobile_permissions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canViewBalance" BOOLEAN NOT NULL DEFAULT true,
    "canViewTransactions" BOOLEAN NOT NULL DEFAULT true,
    "canViewUtxos" BOOLEAN NOT NULL DEFAULT true,
    "canCreateTransaction" BOOLEAN NOT NULL DEFAULT true,
    "canBroadcast" BOOLEAN NOT NULL DEFAULT true,
    "canSignPsbt" BOOLEAN NOT NULL DEFAULT true,
    "canGenerateAddress" BOOLEAN NOT NULL DEFAULT true,
    "canManageLabels" BOOLEAN NOT NULL DEFAULT true,
    "canManageDevices" BOOLEAN NOT NULL DEFAULT true,
    "canShareWallet" BOOLEAN NOT NULL DEFAULT true,
    "canDeleteWallet" BOOLEAN NOT NULL DEFAULT true,
    "ownerMaxPermissions" JSONB,
    "lastModifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_permissions_userId_idx" ON "mobile_permissions"("userId");

-- CreateIndex
CREATE INDEX "mobile_permissions_walletId_idx" ON "mobile_permissions"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_permissions_walletId_userId_key" ON "mobile_permissions"("walletId", "userId");

-- AddForeignKey
ALTER TABLE "mobile_permissions" ADD CONSTRAINT "mobile_permissions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_permissions" ADD CONSTRAINT "mobile_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
