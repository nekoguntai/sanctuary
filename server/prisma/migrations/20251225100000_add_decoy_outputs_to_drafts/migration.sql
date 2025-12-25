-- Add decoyOutputs column to draft_transactions table
ALTER TABLE "draft_transactions" ADD COLUMN "decoyOutputs" JSONB;
