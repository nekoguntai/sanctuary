-- Drop the global unique constraint on txid
DROP INDEX IF EXISTS "transactions_txid_key";

-- Create a new unique constraint on (txid, walletId) 
-- This allows the same blockchain transaction to be recorded for multiple wallets
CREATE UNIQUE INDEX "transactions_txid_walletId_key" ON "transactions"("txid", "walletId");
