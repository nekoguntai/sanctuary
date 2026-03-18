-- Vault Policies: spending governance for Bitcoin wallets

-- Add policy governance fields to draft_transactions
ALTER TABLE "draft_transactions" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE "draft_transactions" ADD COLUMN "policySnapshot" JSONB;
ALTER TABLE "draft_transactions" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "draft_transactions" ADD COLUMN "approvedBy" TEXT;

-- Add policy governance permissions to mobile_permissions
ALTER TABLE "mobile_permissions" ADD COLUMN "canApproveTransaction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mobile_permissions" ADD COLUMN "canManagePolicies" BOOLEAN NOT NULL DEFAULT false;

-- Create vault_policies table
CREATE TABLE "vault_policies" (
    "id" TEXT NOT NULL,
    "walletId" TEXT,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enforcement" TEXT NOT NULL DEFAULT 'enforce',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'wallet',
    "sourceId" TEXT,

    CONSTRAINT "vault_policies_pkey" PRIMARY KEY ("id")
);

-- Create approval_requests table
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "draftTransactionId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requiredApprovals" INTEGER NOT NULL,
    "quorumType" TEXT NOT NULL DEFAULT 'any_n',
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "vetoDeadline" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- Create approval_votes table
CREATE TABLE "approval_votes" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_votes_pkey" PRIMARY KEY ("id")
);

-- Create policy_events table
CREATE TABLE "policy_events" (
    "id" TEXT NOT NULL,
    "policyId" TEXT,
    "walletId" TEXT NOT NULL,
    "draftTransactionId" TEXT,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_events_pkey" PRIMARY KEY ("id")
);

-- Create policy_addresses table
CREATE TABLE "policy_addresses" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "listType" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_addresses_pkey" PRIMARY KEY ("id")
);

-- Create policy_usage_windows table
CREATE TABLE "policy_usage_windows" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT,
    "windowType" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "totalSpent" BIGINT NOT NULL DEFAULT 0,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_usage_windows_pkey" PRIMARY KEY ("id")
);

-- Indexes for vault_policies
CREATE INDEX "vault_policies_walletId_enabled_idx" ON "vault_policies"("walletId", "enabled");
CREATE INDEX "vault_policies_groupId_idx" ON "vault_policies"("groupId");
CREATE INDEX "vault_policies_sourceType_idx" ON "vault_policies"("sourceType");

-- Indexes for approval_requests
CREATE INDEX "approval_requests_draftTransactionId_idx" ON "approval_requests"("draftTransactionId");
CREATE INDEX "approval_requests_policyId_idx" ON "approval_requests"("policyId");
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- Indexes and unique constraint for approval_votes
CREATE UNIQUE INDEX "approval_votes_approvalRequestId_userId_key" ON "approval_votes"("approvalRequestId", "userId");
CREATE INDEX "approval_votes_approvalRequestId_idx" ON "approval_votes"("approvalRequestId");
CREATE INDEX "approval_votes_userId_idx" ON "approval_votes"("userId");

-- Indexes for policy_events
CREATE INDEX "policy_events_walletId_createdAt_idx" ON "policy_events"("walletId", "createdAt");
CREATE INDEX "policy_events_policyId_idx" ON "policy_events"("policyId");
CREATE INDEX "policy_events_draftTransactionId_idx" ON "policy_events"("draftTransactionId");

-- Indexes and unique constraint for policy_addresses
CREATE UNIQUE INDEX "policy_addresses_policyId_address_key" ON "policy_addresses"("policyId", "address");
CREATE INDEX "policy_addresses_policyId_listType_idx" ON "policy_addresses"("policyId", "listType");

-- Indexes and unique constraint for policy_usage_windows
CREATE UNIQUE INDEX "policy_usage_windows_policyId_walletId_userId_windowType_win_key" ON "policy_usage_windows"("policyId", "walletId", "userId", "windowType", "windowStart");
CREATE INDEX "policy_usage_windows_walletId_windowType_windowEnd_idx" ON "policy_usage_windows"("walletId", "windowType", "windowEnd");

-- Index for draft_transactions approval status
CREATE INDEX "draft_transactions_walletId_approvalStatus_idx" ON "draft_transactions"("walletId", "approvalStatus");

-- Foreign keys for vault_policies
ALTER TABLE "vault_policies" ADD CONSTRAINT "vault_policies_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vault_policies" ADD CONSTRAINT "vault_policies_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vault_policies" ADD CONSTRAINT "vault_policies_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys for approval_requests
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_draftTransactionId_fkey" FOREIGN KEY ("draftTransactionId") REFERENCES "draft_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys for approval_votes
ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys for policy_events
ALTER TABLE "policy_events" ADD CONSTRAINT "policy_events_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys for policy_addresses
ALTER TABLE "policy_addresses" ADD CONSTRAINT "policy_addresses_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys for policy_usage_windows
ALTER TABLE "policy_usage_windows" ADD CONSTRAINT "policy_usage_windows_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "vault_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
