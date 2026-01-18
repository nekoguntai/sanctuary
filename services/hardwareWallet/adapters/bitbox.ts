/**
 * BitBox02 Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for BitBox02 devices using WebHID.
 * Supports BitBox02 Multi and BitBox02 Bitcoin-only editions.
 */

import {
  BitBox02API,
  getDevicePath,
  constants,
  getKeypathFromString,
  HARDENED,
  isErrorAbort,
} from 'bitbox02-api';
import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../utils/logger';
import { normalizeDerivationPath } from '../../../shared/utils/bitcoin';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../types';

const log = createLogger('BitBoxAdapter');

// BitBox02 USB identifiers
const BITBOX_VENDOR_ID = 0x03eb;
const BITBOX_PRODUCT_ID = 0x2403;

// Connection state
interface BitBoxConnection {
  api: BitBox02API;
  devicePath: string;
  product: number; // constants.Product.BitBox02Multi or BitBox02BTCOnly
}

/**
 * Get script type constant from path or script type string
 */
const getSimpleType = (
  scriptType?: string,
  path?: string
): number => {
  // If scriptType is provided, use it
  if (scriptType) {
    switch (scriptType) {
      case 'p2wpkh':
        return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
      case 'p2sh-p2wpkh':
        return constants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH;
      case 'p2tr':
        return constants.messages.BTCScriptConfig_SimpleType.P2TR;
      default:
        return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
    }
  }

  // Infer from path
  if (path) {
    if (path.includes("/84'") || path.includes("/84h")) {
      return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
    }
    if (path.includes("/49'") || path.includes("/49h")) {
      return constants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH;
    }
    if (path.includes("/86'") || path.includes("/86h")) {
      return constants.messages.BTCScriptConfig_SimpleType.P2TR;
    }
  }

  return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
};

/**
 * Get xpub type constant from path
 */
const getXpubType = (path: string, isTestnet: boolean): number => {
  if (path.includes("/84'") || path.includes("/84h")) {
    return isTestnet
      ? constants.messages.BTCXPubType.VPUB
      : constants.messages.BTCXPubType.ZPUB;
  }
  if (path.includes("/49'") || path.includes("/49h")) {
    return isTestnet
      ? constants.messages.BTCXPubType.UPUB
      : constants.messages.BTCXPubType.YPUB;
  }
  if (path.includes("/86'") || path.includes("/86h")) {
    // Taproot - use xpub/tpub
    return isTestnet
      ? constants.messages.BTCXPubType.TPUB
      : constants.messages.BTCXPubType.XPUB;
  }
  // Default to standard xpub/tpub
  return isTestnet
    ? constants.messages.BTCXPubType.TPUB
    : constants.messages.BTCXPubType.XPUB;
};

/**
 * Get coin constant from path
 */
const getCoin = (path: string): number => {
  const isTestnet = path.includes("/1'") || path.includes("/1h");
  return isTestnet
    ? constants.messages.BTCCoin.TBTC
    : constants.messages.BTCCoin.BTC;
};

/**
 * Get output type constant from address
 */
const getOutputType = (address: string, network: bitcoin.Network): number => {
  try {
    // Try to decode as different address types
    try {
      const decoded = bitcoin.address.fromBech32(address);
      if (decoded.version === 0) {
        return decoded.data.length === 20
          ? constants.messages.BTCOutputType.P2WPKH
          : constants.messages.BTCOutputType.P2WSH;
      }
      if (decoded.version === 1) {
        return constants.messages.BTCOutputType.P2TR;
      }
    } catch {
      // Not bech32
    }

    try {
      const decoded = bitcoin.address.fromBase58Check(address);
      if (decoded.version === network.pubKeyHash) {
        return constants.messages.BTCOutputType.P2PKH;
      }
      if (decoded.version === network.scriptHash) {
        return constants.messages.BTCOutputType.P2SH;
      }
    } catch {
      // Not base58
    }
  } catch (e) {
    log.warn('Could not determine output type', { address, error: e });
  }

  // Default to P2WPKH
  return constants.messages.BTCOutputType.P2WPKH;
};

/**
 * Extract account path from full derivation path (first 4 components)
 */
const extractAccountPath = (fullPath: string): string => {
  const normalized = normalizeDerivationPath(fullPath);
  const parts = normalized.split('/');
  if (parts.length >= 4) {
    return parts.slice(0, 4).join('/');
  }
  return normalized;
};

/**
 * BitBox02 Device Adapter
 */
export class BitBoxAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'bitbox';
  readonly displayName = 'BitBox02';

  private connection: BitBoxConnection | null = null;
  private connectedDevice: HardwareWalletDevice | null = null;
  private pairingCode: string | null = null;
  private pairingResolve: (() => void) | null = null;

  /**
   * Check if WebHID is supported
   */
  isSupported(): boolean {
    const hasWebHID = typeof navigator !== 'undefined' && 'hid' in navigator;
    const isSecure = typeof window !== 'undefined' && window.isSecureContext;
    return hasWebHID && isSecure;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectedDevice !== null && this.connectedDevice.connected;
  }

  /**
   * Get connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Get list of previously authorized BitBox02 devices
   */
  async getAuthorizedDevices(): Promise<HardwareWalletDevice[]> {
    if (!this.isSupported()) {
      return [];
    }

    try {
      const devices = await navigator.hid.getDevices();
      const bitboxDevices = devices.filter(
        (d) => d.vendorId === BITBOX_VENDOR_ID && d.productId === BITBOX_PRODUCT_ID
      );

      return bitboxDevices.map((device) => ({
        id: `bitbox-${device.vendorId}-${device.productId}`,
        type: 'bitbox' as DeviceType,
        name: device.productName || 'BitBox02',
        model: 'BitBox02',
        connected: device.opened || false,
        fingerprint: undefined,
      }));
    } catch (error) {
      log.error('Failed to enumerate devices', { error });
      return [];
    }
  }

  /**
   * Connect to a BitBox02 device
   */
  async connect(): Promise<HardwareWalletDevice> {
    if (!this.isSupported()) {
      throw new Error('WebHID is not supported. Please use Chrome/Edge on HTTPS.');
    }

    // Close existing connection
    if (this.connection) {
      try {
        this.connection.api.close();
      } catch {
        // Ignore close errors
      }
      this.connection = null;
    }

    try {
      // Get device path (returns "WEBHID" for WebHID)
      const devicePath = await getDevicePath();
      log.info('Got device path', { devicePath });

      const api = new BitBox02API(devicePath);

      // Connect with callbacks
      await api.connect(
        // Show pairing code callback
        (pairingCode: string) => {
          log.info('Pairing code received', { pairingCode });
          this.pairingCode = pairingCode;
        },
        // User verify callback - resolve when user confirms pairing
        async () => {
          return new Promise<void>((resolve) => {
            // In a real UI, you'd show the pairing code and wait for user confirmation
            // For now, we auto-confirm after a short delay
            log.info('Waiting for user to confirm pairing on device...');
            this.pairingResolve = resolve;
            // Auto-resolve after user confirms on device
            setTimeout(() => {
              if (this.pairingResolve) {
                this.pairingResolve();
                this.pairingResolve = null;
              }
            }, 100);
          });
        },
        // Attestation callback
        (attestationResult: boolean) => {
          log.info('Attestation result', { attestationResult });
          if (!attestationResult) {
            log.warn('Device attestation failed - this may be a counterfeit device');
          }
        },
        // On close callback
        () => {
          log.info('BitBox02 connection closed');
          this.connection = null;
          if (this.connectedDevice) {
            this.connectedDevice.connected = false;
          }
        },
        // Status callback
        (status: string) => {
          log.info('BitBox02 status', { status });
        }
      );

      // Get product type
      const product = api.firmware().Product();
      const productName =
        product === constants.Product.BitBox02Multi
          ? 'BitBox02 Multi'
          : 'BitBox02 Bitcoin-only';

      log.info('Connected to BitBox02', { product: productName });

      this.connection = { api, devicePath, product };

      this.connectedDevice = {
        id: `bitbox-${BITBOX_VENDOR_ID}-${BITBOX_PRODUCT_ID}`,
        type: 'bitbox',
        name: productName,
        model: productName,
        connected: true,
        fingerprint: undefined, // BitBox02 doesn't expose fingerprint directly
      };

      return this.connectedDevice;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('denied') || message.includes('NotAllowed') || message.includes('User abort')) {
        throw new Error('Access denied. Please allow device access and try again.');
      }
      if (message.includes('Pairing rejected')) {
        throw new Error('Pairing was rejected. Please try again and confirm on the device.');
      }
      if (message.includes('Firmware upgrade required')) {
        throw new Error('Firmware upgrade required. Please update your BitBox02 firmware.');
      }
      if (message.includes('busy')) {
        throw new Error('BitBox02 is busy. Please close other applications using the device.');
      }

      throw new Error(`Failed to connect: ${message}`);
    }
  }

  /**
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.api.close();
      } catch (error) {
        log.warn('Error closing connection', { error });
      }
      this.connection = null;
    }
    this.connectedDevice = null;
    this.pairingCode = null;
    this.pairingResolve = null;
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      const isTestnet = path.includes("/1'") || path.includes("/1h");
      const coin = getCoin(path);
      const keypathArray = getKeypathFromString(path);
      const xpubType = getXpubType(path, isTestnet);

      log.info('Getting xpub', { path, coin, xpubType, isTestnet });

      const xpub = await this.connection.api.btcXPub(coin, keypathArray, xpubType, false);

      log.info('Got xpub', { xpubPrefix: xpub.substring(0, 20) });

      // BitBox02 doesn't return fingerprint with xpub, we'd need to derive it
      // For now, return empty fingerprint
      return {
        xpub,
        fingerprint: '',
        path,
      };
    } catch (error) {
      if (isErrorAbort(error)) {
        throw new Error('Request cancelled on device');
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get xpub: ${message}`);
    }
  }

  /**
   * Verify address on device
   */
  async verifyAddress(path: string, _address: string): Promise<boolean> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      const coin = getCoin(path);
      const keypathArray = getKeypathFromString(path);
      const simpleType = getSimpleType(undefined, path);

      await this.connection.api.btcDisplayAddressSimple(coin, keypathArray, simpleType, true);
      return true;
    } catch (error) {
      if (isErrorAbort(error)) {
        return false;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to verify address: ${message}`);
    }
  }

  /**
   * Sign a PSBT
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    log.info('signPSBT called', {
      hasRequest: !!request,
      psbtLength: request?.psbt?.length || 0,
      inputPathsCount: request?.inputPaths?.length || 0,
      accountPath: request?.accountPath,
      scriptType: request?.scriptType,
    });

    if (!this.connection) {
      log.error('No active connection');
      throw new Error('No device connected');
    }

    try {
      // Parse PSBT
      const psbt = bitcoin.Psbt.fromBase64(request.psbt);
      const tx = psbt.data.globalMap.unsignedTx;

      // Determine account path from request or PSBT
      let accountPath = request.accountPath;
      if (!accountPath && request.inputPaths && request.inputPaths.length > 0) {
        accountPath = extractAccountPath(request.inputPaths[0]);
      }
      if (!accountPath) {
        // Try to extract from PSBT bip32Derivation
        for (const input of psbt.data.inputs) {
          if (input.bip32Derivation && input.bip32Derivation.length > 0) {
            accountPath = extractAccountPath(input.bip32Derivation[0].path);
            break;
          }
        }
      }
      if (!accountPath) {
        accountPath = "m/84'/0'/0'";
      }

      log.info('Using account path', { accountPath });

      const coin = getCoin(accountPath);
      const simpleType = getSimpleType(request.scriptType, accountPath);
      const keypathAccount = getKeypathFromString(accountPath);

      // Determine network
      const isTestnet = accountPath.includes("/1'") || accountPath.includes("/1h");
      const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

      // Build inputs array for BitBox02
      const inputs: Array<{
        prevOutHash: Uint8Array;
        prevOutIndex: number;
        prevOutValue: string;
        sequence: number;
        keypath: number[];
      }> = [];

      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const input = psbt.data.inputs[i];
        const txInput = psbt.txInputs[i];

        // Get value from witnessUtxo or nonWitnessUtxo
        let value: bigint | number = 0n;
        if (input.witnessUtxo) {
          value = BigInt(input.witnessUtxo.value);
        } else if (input.nonWitnessUtxo && txInput) {
          const prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
          value = BigInt(prevTx.outs[txInput.index].value);
        }

        // Get keypath from bip32Derivation or inputPaths
        let keypath: number[] = [];
        if (input.bip32Derivation && input.bip32Derivation.length > 0) {
          keypath = getKeypathFromString(input.bip32Derivation[0].path);
        } else if (request.inputPaths && request.inputPaths[i]) {
          keypath = getKeypathFromString(request.inputPaths[i]);
        } else {
          // Default to first address of account
          keypath = [...keypathAccount, 0, 0];
        }

        inputs.push({
          prevOutHash: new Uint8Array(txInput.hash),
          prevOutIndex: txInput.index,
          prevOutValue: value.toString(),
          sequence: txInput.sequence,
          keypath,
        });
      }

      // Build outputs array for BitBox02
      const outputs: Array<{
        ours: boolean;
        type?: number;
        payload?: Uint8Array;
        keypath?: number[];
        value: string;
      }> = [];

      for (let i = 0; i < psbt.txOutputs.length; i++) {
        const output = psbt.txOutputs[i];
        const outputData = psbt.data.outputs[i];
        const value = BigInt(output.value).toString();

        // Check if this is a change output (has bip32Derivation with our account path)
        const isChange =
          outputData?.bip32Derivation &&
          outputData.bip32Derivation.length > 0 &&
          outputData.bip32Derivation[0].path.startsWith(accountPath.replace("m/", ""));

        if (isChange && outputData?.bip32Derivation) {
          // Change output
          outputs.push({
            ours: true,
            keypath: getKeypathFromString(outputData.bip32Derivation[0].path),
            value,
          });
        } else {
          // External output
          const address = output.address || '';
          const outputType = getOutputType(address, network);

          // Get payload (hash) from address
          let payload = new Uint8Array(0);
          try {
            if (address.startsWith('bc1') || address.startsWith('tb1')) {
              const decoded = bitcoin.address.fromBech32(address);
              payload = new Uint8Array(decoded.data);
            } else {
              const decoded = bitcoin.address.fromBase58Check(address);
              payload = new Uint8Array(decoded.hash);
            }
          } catch (e) {
            log.warn('Could not decode address', { address, error: e });
          }

          outputs.push({
            ours: false,
            type: outputType,
            payload,
            value,
          });
        }
      }

      log.info('Calling btcSignSimple', {
        coin,
        simpleType,
        inputCount: inputs.length,
        outputCount: outputs.length,
      });

      // Get transaction version and locktime
      const version = psbt.version;
      const locktime = psbt.locktime;

      // Sign the transaction
      const signatures = await this.connection.api.btcSignSimple(
        coin,
        simpleType,
        keypathAccount,
        inputs,
        outputs,
        version,
        locktime
      );

      log.info('Got signatures from device', { signatureCount: signatures.length });

      // Apply signatures to PSBT
      for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        const input = psbt.data.inputs[i];

        if (input.bip32Derivation && input.bip32Derivation.length > 0) {
          const pubkey = input.bip32Derivation[0].pubkey;

          // BitBox02 returns 64-byte signatures (r || s), need to add sighash byte
          const sighashType = input.sighashType || bitcoin.Transaction.SIGHASH_ALL;
          const fullSig = Buffer.concat([
            Buffer.from(sig),
            Buffer.from([sighashType]),
          ]);

          psbt.updateInput(i, {
            partialSig: [
              {
                pubkey,
                signature: fullSig,
              },
            ],
          });
        }
      }

      // Finalize
      psbt.finalizeAllInputs();

      log.info('PSBT signed and finalized successfully', { signatureCount: signatures.length });

      return {
        psbt: psbt.toBase64(),
        signatures: signatures.length,
      };
    } catch (error) {
      if (isErrorAbort(error)) {
        throw new Error('Transaction rejected on device. Please approve the transaction on your BitBox02.');
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('PSBT signing failed', { error: message });

      if (message.includes('busy')) {
        throw new Error('BitBox02 is busy. Please close other applications using the device.');
      }

      throw new Error(`Failed to sign transaction: ${message}`);
    }
  }
}
