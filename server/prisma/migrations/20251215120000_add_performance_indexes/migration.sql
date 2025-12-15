-- Add performance indexes for common query patterns
-- These indexes improve lookup performance for foreign key relationships

-- GroupMember: Lookup by userId (get user's groups) and groupId (get group's members)
CREATE INDEX IF NOT EXISTS "group_members_userId_idx" ON "group_members"("userId");
CREATE INDEX IF NOT EXISTS "group_members_groupId_idx" ON "group_members"("groupId");

-- Wallet: Lookup by groupId (get group's wallets)
CREATE INDEX IF NOT EXISTS "wallets_groupId_idx" ON "wallets"("groupId");

-- WalletUser: Lookup by userId (get user's wallets)
CREATE INDEX IF NOT EXISTS "wallet_users_userId_idx" ON "wallet_users"("userId");

-- Device: Lookup by userId (get user's devices)
CREATE INDEX IF NOT EXISTS "devices_userId_idx" ON "devices"("userId");

-- WalletDevice: Lookup by deviceId (get device's wallets)
CREATE INDEX IF NOT EXISTS "wallet_devices_deviceId_idx" ON "wallet_devices"("deviceId");

-- Transaction: Composite index for sorted queries by wallet and block height
CREATE INDEX IF NOT EXISTS "transactions_walletId_blockHeight_idx" ON "transactions"("walletId", "blockHeight" DESC);
