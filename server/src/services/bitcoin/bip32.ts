/**
 * BIP32 Singleton
 *
 * Shared BIP32 factory instance initialized with tiny-secp256k1.
 * Import this instead of repeating the BIP32Factory + ecc boilerplate.
 */

import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

const bip32 = BIP32Factory(ecc);

export default bip32;
export { bip32 };
