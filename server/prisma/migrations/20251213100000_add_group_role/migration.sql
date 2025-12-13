-- Add groupRole column to wallets table
-- This field defines the default role for group members when accessing the wallet
-- Roles: owner, signer, viewer (default: viewer)

ALTER TABLE "wallets" ADD COLUMN "groupRole" TEXT NOT NULL DEFAULT 'viewer';
