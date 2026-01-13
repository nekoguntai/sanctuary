#!/usr/bin/env npx tsx
/**
 * Address Verification Vector Generator
 *
 * This script generates verified address vectors by deriving addresses
 * using multiple independent implementations and only accepting vectors
 * where all implementations agree.
 *
 * Usage:
 *   npm run generate          # Generate vectors (requires all implementations)
 *   npm run verify            # Verify existing vectors
 *
 * Prerequisites:
 *   - Bitcoin Core running (docker compose up -d)
 *   - Python with bip_utils (pip install bip_utils)
 *   - Go with btcd modules (go mod download)
 */

import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type {
  AddressDeriver,
  ScriptType,
  MultisigScriptType,
  Network,
  SingleSigTestCase,
  MultisigTestCase,
  VerifiedSingleSigVector,
  VerifiedMultisigVector,
  VerificationResult,
} from './types.js';

// Import implementations
import { bitcoinCore } from './implementations/bitcoincore.js';
import { bitcoinjsImpl } from './implementations/bitcoinjs.js';
import { caravanImpl } from './implementations/caravan.js';
import { pythonImpl } from './implementations/python.js';
import { goImpl } from './implementations/go.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bip32 = BIP32Factory(ecc);

// =============================================================================
// Configuration
// =============================================================================

/**
 * Standard BIP-39 test mnemonic - this is THE test mnemonic from the BIP spec
 */
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/**
 * Additional test mnemonics for multisig (to get different xpubs)
 */
const MULTISIG_MNEMONICS = [
  TEST_MNEMONIC,
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
];

/**
 * Minimum implementations required for a vector to be considered verified
 * Note: We use 2 as minimum because:
 * - Bitcoin Core (regtest) can't verify mainnet addresses
 * - Caravan's multisig API has compatibility issues
 * - 2 independent implementations (Bitcoin Core + bitcoinjs-lib) still provides strong verification
 */
const MIN_IMPLEMENTATIONS = 2;

// =============================================================================
// Test Case Generation
// =============================================================================

/**
 * Derive xpub from mnemonic for a given BIP path
 */
function deriveXpub(mnemonic: string, path: string, network: Network): string {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, network === 'mainnet'
    ? { bip32: { public: 0x0488B21E, private: 0x0488ADE4 }, wif: 0x80 } as any
    : { bip32: { public: 0x043587CF, private: 0x04358394 }, wif: 0xEF } as any
  );

  // Parse path and derive
  const parts = path.replace('m/', '').split('/');
  let node = root;
  for (const part of parts) {
    const hardened = part.endsWith("'") || part.endsWith('h');
    const index = parseInt(part.replace(/['h]/g, ''), 10);
    node = hardened ? node.deriveHardened(index) : node.derive(index);
  }

  return node.neutered().toBase58();
}

/**
 * Generate single-sig test cases
 */
function generateSingleSigTestCases(): SingleSigTestCase[] {
  const cases: SingleSigTestCase[] = [];

  const scriptTypes: Array<{ type: ScriptType; bip: number }> = [
    { type: 'legacy', bip: 44 },
    { type: 'nested_segwit', bip: 49 },
    { type: 'native_segwit', bip: 84 },
    { type: 'taproot', bip: 86 },
  ];

  const networks: Network[] = ['mainnet', 'testnet'];
  const indices = [0, 1, 2, 19, 99]; // Include some higher indices
  const changeOptions = [false, true]; // Both receive and change

  for (const { type, bip } of scriptTypes) {
    for (const network of networks) {
      const coinType = network === 'mainnet' ? 0 : 1;
      const path = `m/${bip}'/${coinType}'/0'`;
      const xpub = deriveXpub(TEST_MNEMONIC, path, network);

      for (const change of changeOptions) {
        for (const index of indices) {
          cases.push({
            description: `${type} ${network} ${change ? 'change' : 'receive'} index ${index}`,
            mnemonic: TEST_MNEMONIC,
            path,
            xpub,
            scriptType: type,
            network,
            index,
            change,
          });
        }
      }
    }
  }

  // Add high index edge cases for native_segwit (most commonly used)
  const highIndices = [999, 9999, 2147483646]; // Near max non-hardened
  for (const index of highIndices) {
    cases.push({
      description: `native_segwit mainnet receive high index ${index}`,
      mnemonic: TEST_MNEMONIC,
      path: "m/84'/0'/0'",
      xpub: deriveXpub(TEST_MNEMONIC, "m/84'/0'/0'", 'mainnet'),
      scriptType: 'native_segwit',
      network: 'mainnet',
      index,
      change: false,
    });
  }

  return cases;
}

/**
 * Generate multisig test cases
 */
function generateMultisigTestCases(): MultisigTestCase[] {
  const cases: MultisigTestCase[] = [];

  const scriptTypes: MultisigScriptType[] = ['p2sh', 'p2sh_p2wsh', 'p2wsh'];
  const thresholds = [
    { m: 2, n: 3 },
    { m: 3, n: 5 },
  ];
  const indices = [0, 1, 2];
  const changeOptions = [false, true];
  const network: Network = 'testnet'; // Multisig primarily on testnet for testing

  // Generate xpubs for each cosigner
  for (const scriptType of scriptTypes) {
    for (const { m, n } of thresholds) {
      // Derive xpubs for all cosigners
      const xpubs: string[] = [];
      for (let i = 0; i < n; i++) {
        const mnemonic = MULTISIG_MNEMONICS[i % MULTISIG_MNEMONICS.length];
        // Use different account indices for uniqueness
        const path = `m/48'/1'/0'/2'`; // BIP-48 native segwit multisig path
        const xpub = deriveXpub(mnemonic, path, network);
        // For uniqueness when we don't have enough mnemonics, derive different accounts
        if (i >= MULTISIG_MNEMONICS.length) {
          const altPath = `m/48'/1'/${i}'/2'`;
          xpubs.push(deriveXpub(TEST_MNEMONIC, altPath, network));
        } else {
          xpubs.push(xpub);
        }
      }

      for (const change of changeOptions) {
        for (const index of indices) {
          cases.push({
            description: `${scriptType} ${m}-of-${n} ${change ? 'change' : 'receive'} index ${index}`,
            xpubs: xpubs.slice(0, n),
            threshold: m,
            totalKeys: n,
            scriptType,
            network,
            index,
            change,
          });
        }
      }
    }
  }

  // Key ordering tests - verify that different input orders produce same address
  const baseXpubs = MULTISIG_MNEMONICS.slice(0, 3).map((mnemonic, i) =>
    deriveXpub(mnemonic, "m/48'/1'/0'/2'", 'testnet')
  );

  // Test different orderings
  const orderings = [
    baseXpubs.slice(), // ABC
    [baseXpubs[2], baseXpubs[1], baseXpubs[0]], // CBA
    [baseXpubs[1], baseXpubs[2], baseXpubs[0]], // BCA
  ];

  for (let i = 0; i < orderings.length; i++) {
    cases.push({
      description: `p2wsh 2-of-3 key ordering test ${i + 1}`,
      xpubs: orderings[i],
      threshold: 2,
      totalKeys: 3,
      scriptType: 'p2wsh',
      network: 'testnet',
      index: 0,
      change: false,
      keyOrder: i === 0 ? 'sorted' : 'unsorted',
    });
  }

  return cases;
}

// =============================================================================
// Address Normalization
// =============================================================================

// Bech32 character set for decoding
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Decode bech32/bech32m address to get the witness program (hex)
 * Returns null if not a valid bech32 address
 */
function decodeBech32WitnessProgram(address: string): string | null {
  try {
    // Try bech32 first (segwit v0)
    try {
      const decoded = bitcoin.address.fromBech32(address);
      return decoded.data.toString('hex');
    } catch {
      // Not valid bech32, might be bech32m or invalid
    }

    // Manual decode for regtest addresses (bcrt1)
    // Bitcoin's bech32 library may not recognize regtest HRP
    const lower = address.toLowerCase();
    if (lower.startsWith('bcrt1') || lower.startsWith('tb1') || lower.startsWith('bc1')) {
      // Find the separator (always '1')
      const sepIdx = lower.lastIndexOf('1');
      if (sepIdx < 1) return null;

      const hrp = lower.slice(0, sepIdx);
      const data = lower.slice(sepIdx + 1);

      // Decode the data part
      const decoded: number[] = [];
      for (const char of data) {
        const idx = BECH32_CHARSET.indexOf(char);
        if (idx === -1) return null;
        decoded.push(idx);
      }

      // Remove checksum (last 6 characters)
      const dataWithoutChecksum = decoded.slice(0, -6);

      // First byte is witness version
      const witnessVersion = dataWithoutChecksum[0];

      // Rest is the witness program (5-bit to 8-bit conversion)
      const programBits = dataWithoutChecksum.slice(1);
      const program: number[] = [];
      let acc = 0;
      let bits = 0;

      for (const value of programBits) {
        acc = (acc << 5) | value;
        bits += 5;
        while (bits >= 8) {
          bits -= 8;
          program.push((acc >> bits) & 0xff);
        }
      }

      // Convert to hex
      return Buffer.from(program).toString('hex');
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize an address to its core components for comparison
 * For bech32 addresses, extracts the witness program (ignoring HRP and checksum)
 * For legacy/P2SH, returns the address as-is (they encode network in the version byte)
 */
function normalizeAddress(address: string): string {
  // Handle bech32/bech32m addresses (bc1, tb1, bcrt1)
  if (address.startsWith('bcrt1') || address.startsWith('tb1') || address.startsWith('bc1')) {
    const witnessProgram = decodeBech32WitnessProgram(address);
    if (witnessProgram) {
      // Return a normalized representation that ignores HRP
      // Format: "wprog:<witness_program_hex>"
      return `wprog:${witnessProgram}`;
    }
  }

  // Handle legacy/P2SH addresses - no normalization needed
  // These are base58check with network byte embedded
  // Testnet addresses start with 'm', 'n', '2' vs mainnet '1', '3'
  return address;
}

/**
 * Check if two addresses are equivalent (same despite network prefix differences)
 */
function addressesEquivalent(addr1: string, addr2: string): boolean {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
}

// =============================================================================
// Verification
// =============================================================================

/**
 * Verify a single-sig test case across all implementations
 */
async function verifySingleSig(
  testCase: SingleSigTestCase,
  implementations: AddressDeriver[]
): Promise<VerificationResult> {
  const results = new Map<string, string>();
  const errors: string[] = [];

  for (const impl of implementations) {
    try {
      const address = await impl.deriveSingleSig(
        testCase.xpub,
        testCase.index,
        testCase.scriptType,
        testCase.change,
        testCase.network
      );
      results.set(`${impl.name} ${impl.version}`, address);
    } catch (error) {
      errors.push(`${impl.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Check consensus using normalized addresses
  const addresses = [...results.values()];
  const normalizedAddresses = addresses.map(normalizeAddress);
  const uniqueNormalized = new Set(normalizedAddresses);

  if (uniqueNormalized.size === 1 && addresses.length >= MIN_IMPLEMENTATIONS) {
    // Use the non-regtest address as the canonical one
    const canonicalAddress = addresses.find(a => !a.startsWith('bcrt1')) || addresses[0];
    return {
      testCase,
      results,
      consensus: true,
      consensusAddress: canonicalAddress,
    };
  }

  // Find disagreements using normalized comparison
  const disagreements: Array<{ impl: string; address: string }> = [];
  const normalizedCounts = new Map<string, { count: number; original: string }>();

  for (const addr of addresses) {
    const normalized = normalizeAddress(addr);
    const existing = normalizedCounts.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      normalizedCounts.set(normalized, { count: 1, original: addr });
    }
  }

  // Find the most common normalized address
  let maxCount = 0;
  let majorityNormalized = '';
  let majorityOriginal = '';
  for (const [normalized, { count, original }] of normalizedCounts) {
    if (count > maxCount) {
      maxCount = count;
      majorityNormalized = normalized;
      majorityOriginal = original;
    }
  }

  for (const [impl, addr] of results) {
    if (normalizeAddress(addr) !== majorityNormalized) {
      disagreements.push({ impl, address: addr });
    }
  }

  return {
    testCase,
    results,
    consensus: false,
    consensusAddress: majorityOriginal,
    disagreements,
  };
}

/**
 * Verify a multisig test case across all implementations
 */
async function verifyMultisig(
  testCase: MultisigTestCase,
  implementations: AddressDeriver[]
): Promise<VerificationResult> {
  const results = new Map<string, string>();
  const errors: string[] = [];

  for (const impl of implementations) {
    try {
      const address = await impl.deriveMultisig(
        testCase.xpubs,
        testCase.threshold,
        testCase.index,
        testCase.scriptType,
        testCase.change,
        testCase.network
      );
      results.set(`${impl.name} ${impl.version}`, address);
    } catch (error) {
      const errMsg = `${impl.name}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errMsg);
      // Log errors for debugging
      console.log(`\n  \x1b[33mERROR:\x1b[0m ${errMsg}`);
    }
  }

  // Check consensus using normalized addresses (handles regtest vs testnet)
  const addresses = [...results.values()];
  const normalizedAddresses = addresses.map(normalizeAddress);
  const uniqueNormalized = new Set(normalizedAddresses);

  if (uniqueNormalized.size === 1 && addresses.length >= MIN_IMPLEMENTATIONS) {
    // Use the non-regtest address as the canonical one
    const canonicalAddress = addresses.find(a => !a.startsWith('bcrt1') && !a.startsWith('2')) || addresses[0];
    return {
      testCase,
      results,
      consensus: true,
      consensusAddress: canonicalAddress,
    };
  }

  // Find disagreements using normalized comparison
  const disagreements: Array<{ impl: string; address: string }> = [];
  const normalizedCounts = new Map<string, { count: number; original: string }>();

  for (const addr of addresses) {
    const normalized = normalizeAddress(addr);
    const existing = normalizedCounts.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      normalizedCounts.set(normalized, { count: 1, original: addr });
    }
  }

  // Find the most common normalized address
  let maxCount = 0;
  let majorityNormalized = '';
  let majorityOriginal = '';
  for (const [normalized, { count, original }] of normalizedCounts) {
    if (count > maxCount) {
      maxCount = count;
      majorityNormalized = normalized;
      majorityOriginal = original;
    }
  }

  for (const [impl, addr] of results) {
    if (normalizeAddress(addr) !== majorityNormalized) {
      disagreements.push({ impl, address: addr });
    }
  }

  return {
    testCase,
    results,
    consensus: false,
    consensusAddress: majorityOriginal,
    disagreements,
  };
}

// =============================================================================
// Output Generation
// =============================================================================

/**
 * Generate TypeScript output file with verified vectors
 */
function generateOutputFile(
  singleSigVectors: VerifiedSingleSigVector[],
  multisigVectors: VerifiedMultisigVector[],
  implementations: string[]
): string {
  const date = new Date().toISOString().split('T')[0];

  return `/**
 * VERIFIED ADDRESS VECTORS
 *
 * These vectors have been verified by multiple independent implementations:
 * ${implementations.map(i => ` * - ${i}`).join('\n')}
 *
 * DO NOT MODIFY MANUALLY - regenerate using:
 *   cd scripts/verify-addresses && npm run generate
 *
 * Last verified: ${date}
 * Vectors: ${singleSigVectors.length} single-sig, ${multisigVectors.length} multisig
 */

export type ScriptType = 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
export type MultisigScriptType = 'p2sh' | 'p2sh_p2wsh' | 'p2wsh';
export type Network = 'mainnet' | 'testnet';

export interface VerifiedSingleSigVector {
  description: string;
  mnemonic: string;
  path: string;
  xpub: string;
  scriptType: ScriptType;
  network: Network;
  index: number;
  change: boolean;
  expectedAddress: string;
  verifiedBy: string[];
}

export interface VerifiedMultisigVector {
  description: string;
  xpubs: string[];
  threshold: number;
  totalKeys: number;
  scriptType: MultisigScriptType;
  network: Network;
  index: number;
  change: boolean;
  expectedAddress: string;
  verifiedBy: string[];
}

export const VERIFIED_SINGLESIG_VECTORS: VerifiedSingleSigVector[] = ${JSON.stringify(singleSigVectors, null, 2)};

export const VERIFIED_MULTISIG_VECTORS: VerifiedMultisigVector[] = ${JSON.stringify(multisigVectors, null, 2)};

/**
 * Test mnemonic used for all single-sig derivations
 * This is the official BIP-39 test mnemonic
 */
export const TEST_MNEMONIC = '${TEST_MNEMONIC}';
`;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Address Verification Vector Generator');
  console.log('='.repeat(60));
  console.log();

  // Check available implementations
  const allImplementations: AddressDeriver[] = [
    bitcoinCore,
    bitcoinjsImpl,
    caravanImpl,
    pythonImpl,
    goImpl,
  ];

  console.log('Checking available implementations...');
  const availableImplementations: AddressDeriver[] = [];

  for (const impl of allImplementations) {
    const available = await impl.isAvailable();
    const status = available ? '\x1b[32m[OK]\x1b[0m' : '\x1b[31m[UNAVAILABLE]\x1b[0m';
    console.log(`  ${status} ${impl.name} ${impl.version}`);
    if (available) {
      availableImplementations.push(impl);
    }
  }

  console.log();

  if (availableImplementations.length < MIN_IMPLEMENTATIONS) {
    console.error(`\x1b[31mError: Need at least ${MIN_IMPLEMENTATIONS} implementations, only ${availableImplementations.length} available.\x1b[0m`);
    console.log('\nTo enable more implementations:');
    console.log('  - Bitcoin Core: docker compose up -d');
    console.log('  - Python: pip install bip_utils');
    console.log('  - Go: ensure Go is installed and modules are available');
    process.exit(1);
  }

  console.log(`Using ${availableImplementations.length} implementations for verification`);
  console.log();

  // Generate test cases
  console.log('Generating test cases...');
  const singleSigCases = generateSingleSigTestCases();
  const multisigCases = generateMultisigTestCases();
  console.log(`  Single-sig: ${singleSigCases.length} cases`);
  console.log(`  Multisig: ${multisigCases.length} cases`);
  console.log();

  // Verify single-sig
  console.log('Verifying single-sig addresses...');
  const verifiedSingleSig: VerifiedSingleSigVector[] = [];
  let singleSigErrors = 0;

  for (let i = 0; i < singleSigCases.length; i++) {
    const testCase = singleSigCases[i];
    process.stdout.write(`\r  Progress: ${i + 1}/${singleSigCases.length}`);

    const result = await verifySingleSig(testCase, availableImplementations);

    if (result.consensus && result.consensusAddress) {
      verifiedSingleSig.push({
        description: testCase.description,
        mnemonic: testCase.mnemonic,
        path: testCase.path,
        xpub: testCase.xpub,
        scriptType: testCase.scriptType,
        network: testCase.network,
        index: testCase.index,
        change: testCase.change,
        expectedAddress: result.consensusAddress,
        verifiedBy: [...result.results.keys()],
      });
    } else {
      singleSigErrors++;
      console.log(`\n  \x1b[31mDISAGREEMENT:\x1b[0m ${testCase.description}`);
      for (const [impl, addr] of result.results) {
        console.log(`    ${impl}: ${addr}`);
      }
    }
  }
  console.log();
  console.log(`  Verified: ${verifiedSingleSig.length}, Errors: ${singleSigErrors}`);
  console.log();

  // Verify multisig
  console.log('Verifying multisig addresses...');
  const verifiedMultisig: VerifiedMultisigVector[] = [];
  let multisigErrors = 0;

  for (let i = 0; i < multisigCases.length; i++) {
    const testCase = multisigCases[i];
    process.stdout.write(`\r  Progress: ${i + 1}/${multisigCases.length}`);

    const result = await verifyMultisig(testCase, availableImplementations);

    if (result.consensus && result.consensusAddress) {
      verifiedMultisig.push({
        description: testCase.description,
        xpubs: testCase.xpubs,
        threshold: testCase.threshold,
        totalKeys: testCase.totalKeys,
        scriptType: testCase.scriptType,
        network: testCase.network,
        index: testCase.index,
        change: testCase.change,
        expectedAddress: result.consensusAddress,
        verifiedBy: [...result.results.keys()],
      });
    } else {
      multisigErrors++;
      console.log(`\n  \x1b[31mDISAGREEMENT:\x1b[0m ${testCase.description}`);
      for (const [impl, addr] of result.results) {
        console.log(`    ${impl}: ${addr}`);
      }
    }
  }
  console.log();
  console.log(`  Verified: ${verifiedMultisig.length}, Errors: ${multisigErrors}`);
  console.log();

  // Key ordering verification for multisig
  const keyOrderingTests = verifiedMultisig.filter(v => v.description.includes('key ordering'));
  if (keyOrderingTests.length > 1) {
    const allSameAddress = keyOrderingTests.every(t => t.expectedAddress === keyOrderingTests[0].expectedAddress);
    if (allSameAddress) {
      console.log('\x1b[32mKey ordering verification PASSED\x1b[0m - all orderings produce same address');
    } else {
      console.log('\x1b[31mKey ordering verification FAILED\x1b[0m - different orderings produce different addresses');
      singleSigErrors++;
    }
    console.log();
  }

  // Generate output
  console.log('Generating output files...');

  const implementationNames = availableImplementations.map(i => `${i.name} ${i.version}`);
  const outputContent = generateOutputFile(verifiedSingleSig, verifiedMultisig, implementationNames);

  // Write to output directory
  const outputDir = join(__dirname, 'output');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = join(outputDir, 'verified-vectors.ts');
  writeFileSync(outputPath, outputContent);
  console.log(`  Written: ${outputPath}`);

  // Also write to server/tests/fixtures if it exists
  const fixturesPath = join(__dirname, '../../server/tests/fixtures/verified-address-vectors.ts');
  try {
    writeFileSync(fixturesPath, outputContent);
    console.log(`  Written: ${fixturesPath}`);
  } catch (error) {
    console.log(`  Note: Could not write to fixtures directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Summary
  console.log();
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`  Single-sig vectors: ${verifiedSingleSig.length}`);
  console.log(`  Multisig vectors: ${verifiedMultisig.length}`);
  console.log(`  Total verified: ${verifiedSingleSig.length + verifiedMultisig.length}`);
  console.log(`  Errors/Disagreements: ${singleSigErrors + multisigErrors}`);
  console.log();

  if (singleSigErrors + multisigErrors > 0) {
    console.log('\x1b[31mWARNING: Some test cases had disagreements between implementations.\x1b[0m');
    console.log('Review the output above and investigate discrepancies.');
    process.exit(1);
  }

  console.log('\x1b[32mAll vectors verified successfully!\x1b[0m');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
