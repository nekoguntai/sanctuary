-- Add frozen field to UTXO table for coin control
ALTER TABLE "utxos" ADD COLUMN IF NOT EXISTS "frozen" BOOLEAN NOT NULL DEFAULT false;
