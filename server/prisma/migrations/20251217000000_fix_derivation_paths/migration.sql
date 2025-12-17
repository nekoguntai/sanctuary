-- Fix derivation paths that were incorrectly stored with BIP44 (44')
-- instead of the correct BIP for the wallet's script type
--
-- Root cause: getAccountPath() was returning m/44'/... for xpub-prefix keys
-- regardless of the actual scriptType (native_segwit should use 84', etc.)

-- Fix native_segwit wallets: 44' -> 84'
UPDATE "Address"
SET "derivationPath" = REPLACE("derivationPath", '44''', '84''')
WHERE "walletId" IN (
  SELECT id FROM "Wallet" WHERE "scriptType" = 'native_segwit'
)
AND "derivationPath" LIKE 'm/44''/%';

-- Fix nested_segwit wallets: 44' -> 49'
UPDATE "Address"
SET "derivationPath" = REPLACE("derivationPath", '44''', '49''')
WHERE "walletId" IN (
  SELECT id FROM "Wallet" WHERE "scriptType" = 'nested_segwit'
)
AND "derivationPath" LIKE 'm/44''/%';

-- Fix taproot wallets: 44' -> 86'
UPDATE "Address"
SET "derivationPath" = REPLACE("derivationPath", '44''', '86''')
WHERE "walletId" IN (
  SELECT id FROM "Wallet" WHERE "scriptType" = 'taproot'
)
AND "derivationPath" LIKE 'm/44''/%';
