#!/usr/bin/env python3
"""
Python Address Verification Script

Uses bip_utils library for address derivation - completely independent
from JavaScript implementations.

Usage:
    python python-verify.py single <xpub> <index> <script_type> <change> <network>
    python python-verify.py multi <xpubs_json> <threshold> <index> <script_type> <change> <network>

Output:
    JSON with { "address": "..." } or { "error": "..." }
"""

import sys
import json
from typing import List

try:
    from bip_utils import (
        Bip32Slip10Secp256k1,
        Bip44,
        Bip49,
        Bip84,
        Bip86,
        Bip44Coins,
        Bip49Coins,
        Bip84Coins,
        Bip86Coins,
        P2PKHAddr,
        P2SHAddr,
        P2WPKHAddr,
        P2TRAddr,
        P2WSHAddr,
        CoinsConf,
        Secp256k1PublicKey,
        WifDecoder,
    )
    from bip_utils.bip.bip32 import Bip32Base
    HAS_BIP_UTILS = True
except ImportError:
    HAS_BIP_UTILS = False

try:
    # Alternative: python-bitcoinlib
    import bitcoin
    from bitcoin.core import CScript
    from bitcoin.core.script import OP_0, OP_CHECKMULTISIG
    from bitcoin.wallet import P2PKHBitcoinAddress, P2SHBitcoinAddress, P2WPKHBitcoinAddress
    HAS_PYTHON_BITCOINLIB = True
except ImportError:
    HAS_PYTHON_BITCOINLIB = False


def derive_single_sig_bip_utils(xpub: str, index: int, script_type: str, change: bool, network: str) -> str:
    """Derive single-sig address using bip_utils"""
    from bip_utils import Bip32Secp256k1, Base58Decoder, Base58Encoder
    import hashlib

    # Determine if mainnet or testnet from xpub prefix
    prefix = xpub[:4]
    is_mainnet = prefix in ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub']

    # Convert to standard xpub format if needed
    if prefix not in ['xpub', 'tpub']:
        # Need to convert version bytes
        decoded = Base58Decoder.CheckDecode(xpub)
        if is_mainnet:
            new_version = bytes([0x04, 0x88, 0xB2, 0x1E])
        else:
            new_version = bytes([0x04, 0x35, 0x87, 0xCF])
        converted = new_version + decoded[4:]
        xpub = Base58Encoder.CheckEncode(converted)

    # Parse the xpub
    bip32_ctx = Bip32Secp256k1.FromExtendedKey(xpub)

    # Derive: change / index
    change_idx = 1 if change else 0
    derived = bip32_ctx.DerivePath(f"{change_idx}/{index}")
    pub_key = derived.PublicKey().RawCompressed().ToBytes()

    # Generate address based on script type
    if script_type == 'legacy':
        if is_mainnet:
            return P2PKHAddr.EncodeKey(pub_key, CoinsConf.BitcoinMainNet)
        else:
            return P2PKHAddr.EncodeKey(pub_key, CoinsConf.BitcoinTestNet)

    elif script_type == 'nested_segwit':
        # P2SH-P2WPKH
        # First create the witness program (P2WPKH)
        if is_mainnet:
            p2wpkh = P2WPKHAddr.EncodeKey(pub_key, CoinsConf.BitcoinMainNet)
            # Now wrap in P2SH
            return P2SHAddr.EncodeKey(pub_key, CoinsConf.BitcoinMainNet, P2SHAddr.P2WPKH)
        else:
            return P2SHAddr.EncodeKey(pub_key, CoinsConf.BitcoinTestNet, P2SHAddr.P2WPKH)

    elif script_type == 'native_segwit':
        if is_mainnet:
            return P2WPKHAddr.EncodeKey(pub_key, CoinsConf.BitcoinMainNet)
        else:
            return P2WPKHAddr.EncodeKey(pub_key, CoinsConf.BitcoinTestNet)

    elif script_type == 'taproot':
        # P2TR uses x-only pubkey (32 bytes)
        x_only_pub = pub_key[1:33]  # Remove prefix byte
        if is_mainnet:
            return P2TRAddr.EncodeKey(x_only_pub, CoinsConf.BitcoinMainNet)
        else:
            return P2TRAddr.EncodeKey(x_only_pub, CoinsConf.BitcoinTestNet)

    else:
        raise ValueError(f"Unknown script type: {script_type}")


def derive_multisig_bip_utils(xpubs: List[str], threshold: int, index: int,
                               script_type: str, change: bool, network: str) -> str:
    """Derive multisig address using bip_utils"""
    from bip_utils import Bip32Secp256k1, Base58Decoder, Base58Encoder
    import hashlib

    is_mainnet = network == 'mainnet'
    change_idx = 1 if change else 0

    # Derive public keys from each xpub
    pub_keys = []
    for xpub in xpubs:
        prefix = xpub[:4]
        # Convert to standard format
        if prefix not in ['xpub', 'tpub']:
            decoded = Base58Decoder.CheckDecode(xpub)
            if is_mainnet:
                new_version = bytes([0x04, 0x88, 0xB2, 0x1E])
            else:
                new_version = bytes([0x04, 0x35, 0x87, 0xCF])
            converted = new_version + decoded[4:]
            xpub = Base58Encoder.CheckEncode(converted)

        bip32_ctx = Bip32Secp256k1.FromExtendedKey(xpub)
        derived = bip32_ctx.DerivePath(f"{change_idx}/{index}")
        pub_key = derived.PublicKey().RawCompressed().ToBytes()
        pub_keys.append(pub_key)

    # Sort public keys (BIP-67)
    pub_keys.sort()

    # Build multisig redeem script
    # OP_M <pubkey1> <pubkey2> ... <pubkeyN> OP_N OP_CHECKMULTISIG
    redeem_script = bytes([0x50 + threshold])  # OP_M
    for pk in pub_keys:
        redeem_script += bytes([len(pk)]) + pk
    redeem_script += bytes([0x50 + len(pub_keys)])  # OP_N
    redeem_script += bytes([0xAE])  # OP_CHECKMULTISIG

    # Hash the redeem script
    script_hash = hashlib.sha256(redeem_script).digest()
    script_hash_160 = hashlib.new('ripemd160', script_hash).digest()

    if script_type == 'p2sh':
        # P2SH: hash160 of redeem script
        if is_mainnet:
            return P2SHAddr.EncodeKey(script_hash_160, CoinsConf.BitcoinMainNet, net_ver=bytes([0x05]))
        else:
            return P2SHAddr.EncodeKey(script_hash_160, CoinsConf.BitcoinTestNet, net_ver=bytes([0xC4]))

    elif script_type == 'p2wsh':
        # P2WSH: SHA256 of witness script (same as redeem script for multisig)
        if is_mainnet:
            return P2WSHAddr.EncodeKey(script_hash, CoinsConf.BitcoinMainNet)
        else:
            return P2WSHAddr.EncodeKey(script_hash, CoinsConf.BitcoinTestNet)

    elif script_type == 'p2sh_p2wsh':
        # P2SH-P2WSH: P2SH wrapping P2WSH
        # Create witness script hash (SHA256)
        witness_program = bytes([0x00, 0x20]) + script_hash
        # Hash160 of the witness program
        wp_hash = hashlib.new('ripemd160', hashlib.sha256(witness_program).digest()).digest()
        if is_mainnet:
            return P2SHAddr.EncodeKey(wp_hash, CoinsConf.BitcoinMainNet, net_ver=bytes([0x05]))
        else:
            return P2SHAddr.EncodeKey(wp_hash, CoinsConf.BitcoinTestNet, net_ver=bytes([0xC4]))

    else:
        raise ValueError(f"Unknown multisig script type: {script_type}")


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python-verify.py <command> <args>"}))
        sys.exit(1)

    command = sys.argv[1]

    if command == "check":
        # Check if library is available
        print(json.dumps({
            "available": HAS_BIP_UTILS,
            "version": "1.13.0" if HAS_BIP_UTILS else None,
            "name": "bip_utils"
        }))
        sys.exit(0)

    if not HAS_BIP_UTILS:
        print(json.dumps({"error": "bip_utils library not installed. Run: pip install bip_utils"}))
        sys.exit(1)

    try:
        if command == "single":
            # single <xpub> <index> <script_type> <change> <network>
            if len(sys.argv) != 7:
                print(json.dumps({"error": "Usage: single <xpub> <index> <script_type> <change> <network>"}))
                sys.exit(1)

            xpub = sys.argv[2]
            index = int(sys.argv[3])
            script_type = sys.argv[4]
            change = sys.argv[5].lower() == 'true'
            network = sys.argv[6]

            address = derive_single_sig_bip_utils(xpub, index, script_type, change, network)
            print(json.dumps({"address": address}))

        elif command == "multi":
            # multi <xpubs_json> <threshold> <index> <script_type> <change> <network>
            if len(sys.argv) != 8:
                print(json.dumps({"error": "Usage: multi <xpubs_json> <threshold> <index> <script_type> <change> <network>"}))
                sys.exit(1)

            xpubs = json.loads(sys.argv[2])
            threshold = int(sys.argv[3])
            index = int(sys.argv[4])
            script_type = sys.argv[5]
            change = sys.argv[6].lower() == 'true'
            network = sys.argv[7]

            address = derive_multisig_bip_utils(xpubs, threshold, index, script_type, change, network)
            print(json.dumps({"address": address}))

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
