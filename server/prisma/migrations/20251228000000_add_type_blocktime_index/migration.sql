-- CreateIndex for type filtering with time sorting
CREATE INDEX "transactions_walletId_type_blockTime_idx" ON "transactions"("walletId", "type", "blockTime");
