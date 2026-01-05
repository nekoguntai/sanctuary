-- CreateTable: device_accounts
-- Stores multiple xpub accounts per device for different wallet types (single-sig vs multisig)
CREATE TABLE "device_accounts" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scriptType" TEXT NOT NULL,
    "derivationPath" TEXT NOT NULL,
    "xpub" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: One account per path per device
CREATE UNIQUE INDEX "device_accounts_deviceId_derivationPath_key" ON "device_accounts"("deviceId", "derivationPath");

-- CreateIndex: One account per purpose+scriptType combo per device
CREATE UNIQUE INDEX "device_accounts_deviceId_purpose_scriptType_key" ON "device_accounts"("deviceId", "purpose", "scriptType");

-- CreateIndex: For device lookups
CREATE INDEX "device_accounts_deviceId_idx" ON "device_accounts"("deviceId");

-- CreateIndex: For finding accounts by wallet type
CREATE INDEX "device_accounts_purpose_scriptType_idx" ON "device_accounts"("purpose", "scriptType");

-- AddForeignKey
ALTER TABLE "device_accounts" ADD CONSTRAINT "device_accounts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing devices: Create DeviceAccount records from existing Device xpub/path data
-- This populates the new table with existing device data for backward compatibility
INSERT INTO "device_accounts" ("id", "deviceId", "purpose", "scriptType", "derivationPath", "xpub", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    d.id,
    -- Determine purpose from derivation path
    CASE
        WHEN d."derivationPath" LIKE 'm/48''%' THEN 'multisig'
        ELSE 'single_sig'
    END,
    -- Determine scriptType from derivation path
    CASE
        WHEN d."derivationPath" LIKE 'm/84''%' THEN 'native_segwit'
        WHEN d."derivationPath" LIKE 'm/86''%' THEN 'taproot'
        WHEN d."derivationPath" LIKE 'm/49''%' THEN 'nested_segwit'
        WHEN d."derivationPath" LIKE 'm/44''%' THEN 'legacy'
        WHEN d."derivationPath" LIKE 'm/48''%/0''/0''/2''' THEN 'native_segwit'  -- BIP-48 native segwit multisig
        WHEN d."derivationPath" LIKE 'm/48''%/0''/0''/1''' THEN 'nested_segwit'  -- BIP-48 nested segwit multisig
        ELSE 'native_segwit'  -- Default to native segwit
    END,
    COALESCE(d."derivationPath", 'm/84''/0''/0'''),  -- Default path if null
    d.xpub,
    d."createdAt",
    d."updatedAt"
FROM "devices" d
WHERE d.xpub IS NOT NULL AND d.xpub != '';
