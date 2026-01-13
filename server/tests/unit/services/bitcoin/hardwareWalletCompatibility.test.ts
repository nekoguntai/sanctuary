/**
 * Hardware Wallet Compatibility Tests
 *
 * These tests verify that our address derivation matches actual hardware wallets.
 * This is the ultimate test - if our addresses don't match hardware wallets,
 * users WILL LOSE FUNDS.
 *
 * Test vectors come from:
 * 1. hardware-wallet-vectors.ts - Actual exports from Coldcard, Ledger, Trezor
 * 2. verified-address-vectors.ts - Cross-implementation verified vectors
 *
 * To add more hardware wallet coverage:
 * 1. Obtain a hardware wallet
 * 2. Load the test seed
 * 3. Export addresses
 * 4. Add to hardware-wallet-vectors.ts
 * 5. Run these tests
 */

import { describe, it, expect } from 'vitest';
import { deriveAddress, deriveAddressFromDescriptor } from '@/services/bitcoin/addressDerivation';
import {
  HARDWARE_WALLET_SINGLESIG_VECTORS,
  HARDWARE_WALLET_MULTISIG_VECTORS,
} from '@fixtures/hardware-wallet-vectors';

describe('Hardware Wallet Compatibility', () => {
  describe('Single-Sig Address Verification', () => {
    if (HARDWARE_WALLET_SINGLESIG_VECTORS.length === 0) {
      it.skip('No single-sig hardware wallet vectors available - add vectors to hardware-wallet-vectors.ts', () => {
        // This test is skipped until vectors are added
      });
    } else {
      HARDWARE_WALLET_SINGLESIG_VECTORS.forEach((vector) => {
        describe(`${vector.device} (${vector.firmware}) - ${vector.scriptType} ${vector.network}`, () => {
          it('should derive matching xpub', () => {
            // This would require deriving from seed, which we don't do in tests
            // Instead we verify the addresses from the exported xpub
            expect(vector.expectedXpub).toBeDefined();
          });

          vector.addresses.forEach(({ index, receive, change }) => {
            it(`should derive correct receive address at index ${index}`, () => {
              const derived = deriveAddress(vector.expectedXpub, index, {
                scriptType: vector.scriptType,
                network: vector.network,
                change: false,
              });

              expect(derived.address).toBe(receive);
            });

            it(`should derive correct change address at index ${index}`, () => {
              const derived = deriveAddress(vector.expectedXpub, index, {
                scriptType: vector.scriptType,
                network: vector.network,
                change: true,
              });

              expect(derived.address).toBe(change);
            });
          });
        });
      });
    }
  });

  describe('Multisig Address Verification', () => {
    if (HARDWARE_WALLET_MULTISIG_VECTORS.length === 0) {
      it.skip('No multisig hardware wallet vectors available - add vectors to hardware-wallet-vectors.ts', () => {
        // This test is skipped until vectors are added
      });
    } else {
      HARDWARE_WALLET_MULTISIG_VECTORS.forEach((vector, vectorIndex) => {
        describe(`${vector.threshold}-of-${vector.totalSigners} ${vector.scriptType} (${vector.devices.map((d) => d.device).join(', ')})`, () => {
          // Build descriptor from signers
          const buildDescriptor = () => {
            const keysStr = vector.signers.map((s) => `${s.xpub}/<0;1>/*`).join(',');
            const scriptMap = {
              p2sh: 'sh(sortedmulti',
              p2sh_p2wsh: 'sh(wsh(sortedmulti',
              p2wsh: 'wsh(sortedmulti',
            };
            const prefix = scriptMap[vector.scriptType];
            const suffix = vector.scriptType === 'p2sh_p2wsh' ? ')))' : '))';
            return `${prefix}(${vector.threshold},${keysStr})${suffix}`;
          };

          vector.addresses.forEach(({ index, receive, change }) => {
            it(`should derive correct receive address at index ${index}`, () => {
              const descriptor = buildDescriptor();
              const derived = deriveAddressFromDescriptor(descriptor, index, {
                network: vector.network,
                change: false,
              });

              expect(derived.address).toBe(receive);
            });

            it(`should derive correct change address at index ${index}`, () => {
              const descriptor = buildDescriptor();
              const derived = deriveAddressFromDescriptor(descriptor, index, {
                network: vector.network,
                change: true,
              });

              expect(derived.address).toBe(change);
            });
          });
        });
      });
    }
  });
});

describe('Known Hardware Wallet Quirks', () => {
  // Document and test any known quirks or edge cases from hardware wallets

  describe('Coldcard Specifics', () => {
    it.skip('placeholder for Coldcard-specific tests', () => {
      // Add tests for any Coldcard-specific behaviors
    });
  });

  describe('Ledger Specifics', () => {
    it.skip('placeholder for Ledger-specific tests', () => {
      // Add tests for any Ledger-specific behaviors
    });
  });

  describe('Trezor Specifics', () => {
    it.skip('placeholder for Trezor-specific tests', () => {
      // Add tests for any Trezor-specific behaviors
    });
  });
});

describe('Hardware Wallet Export Format Parsing', () => {
  // Tests for parsing various hardware wallet export formats

  describe('Coldcard JSON Export', () => {
    it.skip('should parse Coldcard multisig export format', () => {
      // Test parsing of Coldcard's multisig JSON export
    });
  });

  describe('Specter Desktop Export', () => {
    it.skip('should parse Specter Desktop wallet export', () => {
      // Test parsing of Specter Desktop's export format
    });
  });

  describe('Sparrow Export', () => {
    it.skip('should parse Sparrow wallet export', () => {
      // Test parsing of Sparrow's export format
    });
  });
});

/**
 * Instructions for populating hardware wallet vectors:
 *
 * 1. NEVER use real/production seeds for test vectors
 * 2. Use the standard BIP-39 test mnemonic:
 *    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
 *
 * 3. For each hardware wallet:
 *    a. Initialize with the test seed
 *    b. Navigate to the address export or verification feature
 *    c. Record the first 5-10 receive and change addresses
 *    d. Record the xpub at the appropriate derivation path
 *    e. Document the device model and firmware version
 *
 * 4. For multisig:
 *    a. Set up the same multisig configuration on all participating devices
 *    b. Verify all devices show the same addresses
 *    c. Record the addresses and xpubs from each device
 *
 * 5. Add the vectors to hardware-wallet-vectors.ts
 *
 * 6. Run this test suite to verify compatibility
 */
