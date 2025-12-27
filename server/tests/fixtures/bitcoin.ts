/**
 * Bitcoin Test Fixtures
 *
 * Sample Bitcoin addresses, transactions, and xpubs for testing.
 * All test data uses testnet/regtest values unless noted.
 */

// ========================================
// TESTNET ADDRESSES
// ========================================

export const testnetAddresses = {
  // P2WPKH (Native SegWit) - tb1q...
  nativeSegwit: [
    'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7',
    'tb1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg',
  ],

  // P2SH (Nested SegWit) - 2...
  nestedSegwit: [
    '2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc',
    '2N3oefVeg6stiTb5Kh3ozCSkaqmx91FDbsm',
  ],

  // P2PKH (Legacy) - m/n...
  legacy: [
    'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn',
    'n3GNqMveyvaPvUbH469vDRadqpJMPc84JA',
  ],

  // P2TR (Taproot) - tb1p...
  taproot: [
    'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c',
  ],
};

// ========================================
// MAINNET ADDRESSES (for validation tests)
// ========================================

export const mainnetAddresses = {
  nativeSegwit: [
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c',
  ],
  nestedSegwit: [
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    '3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC',
  ],
  legacy: [
    '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  ],
  taproot: [
    'bc1pxwww0ct9ue7e8tdnlmug5m2tamfn7q06sahstg39ys4c9f3340qqxrdu9k',
  ],
};

// ========================================
// EXTENDED PUBLIC KEYS (XPUBS)
// ========================================

export const testXpubs = {
  // Testnet xpubs (tpub format)
  // Derived from mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  testnet: {
    // BIP84 (Native SegWit) - m/84'/1'/0'
    bip84: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
    // BIP49 (Nested SegWit) - m/49'/1'/0'
    bip49: 'upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY',
    // BIP44 (Legacy) - m/44'/1'/0'
    bip44: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
  },

  // Mainnet xpubs
  // Derived from standard test mnemonic
  mainnet: {
    // BIP84 (zpub) - m/84'/0'/0' - converted from xpub below
    bip84: 'zpub6qUQGY8YyN3ZxYEgf8J6KCQBqQAbdSWaT9RK54L5FWTTh8na8NkCkZpYHnWt7zEwNhqd6p9Utq562cSZsqGqFE87NNsUKnyZeJ5KvbhfC8E',
    // BIP49 (ypub) - m/49'/0'/0'
    bip49: 'ypub6Ww3ibxVfGzLtJR4F9SRBicspAfvmvw54yern9Q6qZWFC9T6FYA34K57La5Sgs8pXuyvpDfEHX5KNZRiZRukUWaVPyL4NxA69sEAqdoV8ve',
    // BIP44 (xpub) - m/44'/0'/0'
    bip44: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
  },
};

// ========================================
// SAMPLE TRANSACTIONS
// ========================================

export const sampleTransactions = {
  // Simple P2WPKH transaction hex (testnet)
  simpleP2wpkh:
    '02000000000101abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890000000000000000000016400000000000000160014a11b66a67b3ff69671c8f82254099faf374b800a02473044022047ac8e878352d3ebbde1c94ce3a10d057c24175747116f8288e5d794d12d482f0220217f36a485cae903c713331d877c1f64677e3622ad4010726870540656fe9dcb012103ad1d8e89212f0b92c74d23bb710c00662ad1470198ac48c43f7d6f93a2a2687300000000',

  // Simple P2PKH transaction hex (sequence = 0xffffffff, no RBF)
  simpleP2pkh:
    '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',

  // Transaction with RBF signaling (sequence = 0xfffffffd, enables RBF)
  // Same as simpleP2pkh but with fdffffff sequence instead of ffffffff
  rbfEnabled:
    '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901fdffffff0100000000000000000000000000',
};

// ========================================
// SAMPLE UTXOs
// ========================================

export const sampleUtxos = [
  {
    id: 'utxo-1',
    txid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    vout: 0,
    amount: BigInt(100000), // 0.001 BTC
    address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    scriptPubKey: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
    confirmations: 6,
    spent: false,
    frozen: false,
  },
  {
    id: 'utxo-2',
    txid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    vout: 1,
    amount: BigInt(50000), // 0.0005 BTC
    address: 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7',
    scriptPubKey: '00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262',
    confirmations: 10,
    spent: false,
    frozen: false,
  },
  {
    id: 'utxo-3',
    txid: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    vout: 0,
    amount: BigInt(200000), // 0.002 BTC
    address: 'tb1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg',
    scriptPubKey: '00147dd6559648957bf0d012bf563af8199b67da7c9c',
    confirmations: 100,
    spent: false,
    frozen: false,
  },
];

// ========================================
// SAMPLE WALLETS
// ========================================

export const sampleWallets = {
  singleSigNativeSegwit: {
    id: 'wallet-1',
    name: 'Test Native SegWit Wallet',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'testnet',
    descriptor: `wpkh([${testXpubs.testnet.bip84}]/0/*)`,
    fingerprint: 'aabbccdd',
    createdAt: new Date(),
    lastSyncedAt: null,
    lastSyncStatus: null,
    syncInProgress: false,
    quorum: null,
    totalSigners: null,
  },
  singleSigLegacy: {
    id: 'wallet-2',
    name: 'Test Legacy Wallet',
    type: 'single_sig',
    scriptType: 'legacy',
    network: 'testnet',
    descriptor: `pkh([${testXpubs.testnet.bip44}]/0/*)`,
    fingerprint: 'eeff0011',
    createdAt: new Date(),
    lastSyncedAt: null,
    lastSyncStatus: null,
    syncInProgress: false,
    quorum: null,
    totalSigners: null,
  },
  multiSig2of3: {
    id: 'wallet-3',
    name: 'Test 2-of-3 MultiSig',
    type: 'multi_sig',
    scriptType: 'native_segwit',
    network: 'testnet',
    descriptor: 'wsh(sortedmulti(2,[aabbccdd/84h/1h/0h]tpub1.../0/*,[eeff0011/84h/1h/0h]tpub2.../0/*,[22334455/84h/1h/0h]tpub3.../0/*))',
    fingerprint: 'aabbccdd',
    createdAt: new Date(),
    lastSyncedAt: null,
    lastSyncStatus: null,
    syncInProgress: false,
    quorum: 2,
    totalSigners: 3,
  },
};

// ========================================
// SAMPLE USERS
// ========================================

export const sampleUsers = {
  admin: {
    id: 'user-admin',
    username: 'admin',
    password: '$2a$10$hashedpassword', // bcrypt hash
    email: 'admin@example.com',
    isAdmin: true,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorBackupCodes: null,
    preferences: {
      darkMode: true,
      theme: 'sanctuary',
      unit: 'sats',
      fiatCurrency: 'USD',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  regularUser: {
    id: 'user-regular',
    username: 'testuser',
    password: '$2a$10$hashedpassword', // bcrypt hash
    email: 'test@example.com',
    isAdmin: false,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorBackupCodes: null,
    preferences: {
      darkMode: true,
      theme: 'sanctuary',
      unit: 'sats',
      fiatCurrency: 'USD',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  userWith2FA: {
    id: 'user-2fa',
    username: 'secure-user',
    password: '$2a$10$hashedpassword',
    email: 'secure@example.com',
    isAdmin: false,
    twoFactorEnabled: true,
    twoFactorSecret: 'JBSWY3DPEHPK3PXP', // Base32 encoded secret
    twoFactorBackupCodes: JSON.stringify([
      { hash: '$2a$10$backuphash1', used: false },
      { hash: '$2a$10$backuphash2', used: false },
      { hash: '$2a$10$backuphash3', used: true },
    ]),
    preferences: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

// ========================================
// FEE ESTIMATION FIXTURES
// ========================================

export const feeEstimates = {
  highPriority: 50, // sat/vB
  mediumPriority: 20,
  lowPriority: 5,
  minimum: 1,
};

// ========================================
// DERIVATION PATHS
// ========================================

export const derivationPaths = {
  bip44: {
    mainnet: "m/44'/0'/0'",
    testnet: "m/44'/1'/0'",
  },
  bip49: {
    mainnet: "m/49'/0'/0'",
    testnet: "m/49'/1'/0'",
  },
  bip84: {
    mainnet: "m/84'/0'/0'",
    testnet: "m/84'/1'/0'",
  },
  bip86: {
    mainnet: "m/86'/0'/0'",
    testnet: "m/86'/1'/0'",
  },
};

export default {
  testnetAddresses,
  mainnetAddresses,
  testXpubs,
  sampleTransactions,
  sampleUtxos,
  sampleWallets,
  sampleUsers,
  feeEstimates,
  derivationPaths,
};
