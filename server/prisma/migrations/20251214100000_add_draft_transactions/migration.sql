-- CreateTable
CREATE TABLE "draft_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "feeRate" INTEGER NOT NULL,
    "selectedUtxoIds" TEXT[],
    "enableRBF" BOOLEAN NOT NULL DEFAULT true,
    "subtractFees" BOOLEAN NOT NULL DEFAULT false,
    "sendMax" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "memo" TEXT,
    "psbtBase64" TEXT NOT NULL,
    "signedPsbtBase64" TEXT,
    "fee" BIGINT NOT NULL,
    "totalInput" BIGINT NOT NULL,
    "totalOutput" BIGINT NOT NULL,
    "changeAmount" BIGINT NOT NULL,
    "changeAddress" TEXT,
    "effectiveAmount" BIGINT NOT NULL,
    "inputPaths" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'unsigned',
    "signedDeviceIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "draft_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "draft_transactions_walletId_status_idx" ON "draft_transactions"("walletId", "status");

-- CreateIndex
CREATE INDEX "draft_transactions_userId_idx" ON "draft_transactions"("userId");

-- AddForeignKey
ALTER TABLE "draft_transactions" ADD CONSTRAINT "draft_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_transactions" ADD CONSTRAINT "draft_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
