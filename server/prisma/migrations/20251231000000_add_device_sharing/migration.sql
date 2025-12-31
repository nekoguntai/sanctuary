-- Add device sharing support
-- This migration adds the ability to share devices with users and groups

-- Add group sharing columns to devices table
ALTER TABLE "devices" ADD COLUMN "groupId" TEXT;
ALTER TABLE "devices" ADD COLUMN "groupRole" TEXT NOT NULL DEFAULT 'viewer';

-- Create device_users junction table for user-level device sharing
CREATE TABLE "device_users" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_users_pkey" PRIMARY KEY ("id")
);

-- Add unique constraint (one role per user per device)
CREATE UNIQUE INDEX "device_users_deviceId_userId_key" ON "device_users"("deviceId", "userId");

-- Add indexes for efficient lookups
CREATE INDEX "device_users_userId_idx" ON "device_users"("userId");
CREATE INDEX "device_users_deviceId_idx" ON "device_users"("deviceId");
CREATE INDEX "devices_groupId_idx" ON "devices"("groupId");

-- Add foreign key constraints
ALTER TABLE "devices" ADD CONSTRAINT "devices_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "device_users" ADD CONSTRAINT "device_users_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_users" ADD CONSTRAINT "device_users_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing devices: create owner record in device_users for each device
-- This ensures the original owner has explicit ownership in the new system
INSERT INTO "device_users" ("id", "deviceId", "userId", "role", "createdAt")
SELECT
    gen_random_uuid()::text,
    d."id",
    d."userId",
    'owner',
    d."createdAt"
FROM "devices" d;
