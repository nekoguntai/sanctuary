/**
 * BIP-143 Official Test Vectors (Transaction Signature Verification for SegWit)
 * https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
 * DO NOT MODIFY - these are canonical Bitcoin protocol test vectors.
 */

export interface Bip143TestVector {
  description: string;
  unsignedTxHex: string;
  inputIndex: number;
  scriptCodeHex: string;
  value: number;  // satoshis
  hashType: number;
  expectedSigHash: string;
}

export const BIP143_TEST_VECTORS: Bip143TestVector[] = [
  {
    description: 'Native P2WPKH (second input)',
    unsignedTxHex: '0100000002fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f0000000000eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac11000000',
    inputIndex: 1,
    scriptCodeHex: '76a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac',
    value: 600000000,
    hashType: 1,  // SIGHASH_ALL
    expectedSigHash: 'c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670',
  },
  {
    description: 'P2SH-P2WPKH',
    unsignedTxHex: '0100000001db6b1b20aa0fd7b23880be2ecbd4a98130974cf4748fb66092ac4d3ceb1a54770100000000feffffff02b8b4eb0b000000001976a914a457b684d7f0d539a46a45bbc043f35b59d0d96388ac0008af2f000000001976a914fd270b1ee6abcaea97fea7ad0402e8bd8ad6d77c88ac92040000',
    inputIndex: 0,
    scriptCodeHex: '76a91479091972186c449eb1ded22b78e40d009bdf008988ac',
    value: 1000000000,
    hashType: 1,  // SIGHASH_ALL
    expectedSigHash: '64f3b0f4dd2bb3aa1ce8566d220cc74dda9df97d8490cc81d89d735c92e59fb6',
  },
];
