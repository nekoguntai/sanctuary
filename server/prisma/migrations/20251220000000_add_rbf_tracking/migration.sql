-- RBF Transaction Tracking
-- AlterTable: Add RBF tracking fields to transactions
ALTER TABLE "transactions" ADD COLUMN "replacedByTxid" TEXT,
ADD COLUMN "replacementForTxid" TEXT,
ADD COLUMN "rbfStatus" TEXT NOT NULL DEFAULT 'active';

-- CreateIndex: RBF tracking indexes
CREATE INDEX "transactions_walletId_rbfStatus_idx" ON "transactions"("walletId", "rbfStatus");
CREATE INDEX "transactions_replacedByTxid_idx" ON "transactions"("replacedByTxid");
CREATE INDEX "transactions_replacementForTxid_idx" ON "transactions"("replacementForTxid");

-- Draft UTXO Locking
-- AlterTable: Add isRBF flag to draft transactions
ALTER TABLE "draft_transactions" ADD COLUMN "isRBF" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: Draft UTXO locks junction table
CREATE TABLE "draft_utxo_locks" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "utxoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_utxo_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Draft UTXO lock indexes
CREATE UNIQUE INDEX "draft_utxo_locks_draftId_utxoId_key" ON "draft_utxo_locks"("draftId", "utxoId");
CREATE UNIQUE INDEX "draft_utxo_locks_utxoId_key" ON "draft_utxo_locks"("utxoId");
CREATE INDEX "draft_utxo_locks_draftId_idx" ON "draft_utxo_locks"("draftId");
CREATE INDEX "draft_utxo_locks_utxoId_idx" ON "draft_utxo_locks"("utxoId");

-- AddForeignKey: Draft UTXO locks relationships with cascade delete
ALTER TABLE "draft_utxo_locks" ADD CONSTRAINT "draft_utxo_locks_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "draft_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_utxo_locks" ADD CONSTRAINT "draft_utxo_locks_utxoId_fkey" FOREIGN KEY ("utxoId") REFERENCES "utxos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
