/**
 * Trezor Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for Trezor devices using Trezor Suite bridge.
 * Supports Model One, Model T, Safe 3, Safe 5, and Safe 7.
 */

import TrezorConnect from '@trezor/connect-web';
import * as bitcoin from 'bitcoinjs-lib';
import apiClient from '../../../src/api/client';
import { createLogger } from '../../../utils/logger';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../types';

const log = createLogger('TrezorAdapter');

// Connection state
interface TrezorConnection {
  initialized: boolean;
  connected: boolean;
  deviceId?: string;
  fingerprint?: string;
  model?: string;
  label?: string;
}

/**
 * Determine Trezor script type from BIP path
 */
const getTrezorScriptType = (path: string): 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT' => {
  if (path.startsWith("m/44'") || path.startsWith("44'")) {
    return 'SPENDADDRESS';
  }
  if (path.startsWith("m/49'") || path.startsWith("49'")) {
    return 'SPENDP2SHWITNESS';
  }
  if (path.startsWith("m/84'") || path.startsWith("84'")) {
    return 'SPENDWITNESS';
  }
  if (path.startsWith("m/86'") || path.startsWith("86'")) {
    return 'SPENDTAPROOT';
  }
  return 'SPENDWITNESS';
};

/**
 * Convert path string to Trezor address_n array
 */
const pathToAddressN = (path: string): number[] => {
  return path
    .replace(/^m\//, '')
    .split('/')
    .map(part => {
      const hardened = part.endsWith("'") || part.endsWith('h');
      const index = parseInt(part.replace(/['h]/g, ''), 10);
      return hardened ? index + 0x80000000 : index;
    });
};

/**
 * Fetch reference transactions needed for Trezor signing
 */
const fetchRefTxs = async (psbt: bitcoin.Psbt): Promise<any[]> => {
  const refTxs: any[] = [];
  const seenTxids = new Set<string>();

  for (const input of psbt.data.inputs) {
    const txInput = psbt.txInputs[psbt.data.inputs.indexOf(input)];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');

    if (seenTxids.has(txid)) continue;
    seenTxids.add(txid);

    try {
      const response = await apiClient.get<{ hex: string }>(`/transactions/${txid}/raw`);
      const rawTx = bitcoin.Transaction.fromHex(response.hex);

      const refTx = {
        hash: txid,
        version: rawTx.version,
        lock_time: rawTx.locktime,
        inputs: rawTx.ins.map(input => ({
          prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
          prev_index: input.index,
          script_sig: input.script.toString('hex'),
          sequence: input.sequence,
        })),
        bin_outputs: rawTx.outs.map(output => ({
          amount: output.value,
          script_pubkey: output.script.toString('hex'),
        })),
      };

      refTxs.push(refTx);
    } catch (error) {
      log.warn('Failed to fetch reference transaction', { txid, error });
    }
  }

  return refTxs;
};

/**
 * Trezor Device Adapter
 */
export class TrezorAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'trezor';
  readonly requiresBridge = true;
  readonly displayName = 'Trezor';

  private connection: TrezorConnection = {
    initialized: false,
    connected: false,
  };
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Trezor uses bridge mode - always supported if Trezor Suite is running
   */
  isSupported(): boolean {
    return true;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection.connected;
  }

  /**
   * Get connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Initialize Trezor Connect
   */
  private async initialize(): Promise<void> {
    if (this.connection.initialized) {
      return;
    }

    try {
      await TrezorConnect.init({
        manifest: {
          email: 'support@sanctuary.bitcoin',
          appUrl: window.location.origin || 'https://sanctuary.bitcoin',
          appName: 'Sanctuary',
        },
        coreMode: 'auto',
        debug: true,
        lazyLoad: false,
      });

      this.connection.initialized = true;
      log.info('Trezor Connect initialized');
    } catch (error) {
      log.error('Failed to initialize Trezor Connect', { error });
      throw new Error('Failed to initialize Trezor. Please ensure Trezor Suite is running.');
    }
  }

  /**
   * Connect to a Trezor device
   */
  async connect(): Promise<HardwareWalletDevice> {
    if (!this.connection.initialized) {
      await this.initialize();
    }

    try {
      log.info('Requesting Trezor device features...');

      const result = await TrezorConnect.getFeatures();

      if (!result.success) {
        const errorPayload = result.payload as { error?: string; code?: string };
        log.error('Trezor getFeatures failed', { payload: errorPayload });
        throw new Error(errorPayload.error || 'Failed to connect to Trezor');
      }

      const features = result.payload;

      // Get master fingerprint
      let fingerprint: string | undefined;
      try {
        const fpResult = await TrezorConnect.getPublicKey({
          path: "m/0'",
          showOnTrezor: false,
        });
        if (fpResult.success) {
          fingerprint = fpResult.payload.fingerprint?.toString(16).padStart(8, '0');
        }
      } catch {
        log.warn('Could not get fingerprint from Trezor');
      }

      // Determine model name
      let modelName = 'Trezor';
      if (features.model === 'T') {
        modelName = 'Trezor Model T';
      } else if (features.model === '1') {
        modelName = 'Trezor Model One';
      } else if (features.internal_model === 'T2B1') {
        modelName = 'Trezor Safe 3';
      } else if (features.internal_model === 'T3T1') {
        modelName = 'Trezor Safe 5';
      } else if (features.internal_model === 'T3W1') {
        modelName = 'Trezor Safe 7';
      }

      this.connection = {
        initialized: true,
        connected: true,
        deviceId: features.device_id || undefined,
        fingerprint,
        model: modelName,
        label: features.label || undefined,
      };

      this.connectedDevice = {
        id: `trezor-${features.device_id || 'unknown'}`,
        type: 'trezor',
        name: features.label || modelName,
        model: modelName,
        connected: true,
        fingerprint,
        needsPin: features.pin_protection && !features.unlocked,
        needsPassphrase: features.passphrase_protection,
      };

      log.info('Trezor connected', {
        model: modelName,
        label: features.label,
        fingerprint,
      });

      return this.connectedDevice;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to connect Trezor', { error: message });

      if (message.includes('Popup closed') || message.includes('cancelled')) {
        throw new Error('Connection cancelled by user');
      }
      if (message.includes('Device not found') || message.includes('no device')) {
        throw new Error('No Trezor device found. Please connect your device and ensure Trezor Suite is running.');
      }
      if (message.includes('Bridge not running')) {
        throw new Error('Trezor Suite bridge not running. Please open Trezor Suite desktop app.');
      }

      throw new Error(`Failed to connect Trezor: ${message}`);
    }
  }

  /**
   * Disconnect from Trezor
   */
  async disconnect(): Promise<void> {
    this.connection = {
      initialized: this.connection.initialized,
      connected: false,
    };
    this.connectedDevice = null;
    log.info('Trezor disconnected');
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }

    try {
      const isTestnet = path.includes("/1'/") || path.includes("/1h/");

      const result = await TrezorConnect.getPublicKey({
        path,
        showOnTrezor: false,
        coin: isTestnet ? 'Testnet' : 'Bitcoin',
      });

      if (!result.success) {
        const errorMsg = 'error' in result.payload ? result.payload.error : 'Failed to get public key';
        throw new Error(errorMsg);
      }

      const { xpub, fingerprint } = result.payload;
      const fpHex = fingerprint?.toString(16).padStart(8, '0') || this.connection.fingerprint || '';

      log.info('Got Trezor xpub', {
        path,
        xpubPrefix: xpub.substring(0, 15),
        fingerprint: fpHex,
      });

      return {
        xpub,
        fingerprint: fpHex,
        path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('cancelled') || message.includes('Cancelled')) {
        throw new Error('Request cancelled on device');
      }

      throw new Error(`Failed to get xpub from Trezor: ${message}`);
    }
  }

  /**
   * Sign a PSBT with Trezor
   * Note: Trezor returns a fully signed raw transaction, not a PSBT
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }

    log.info('Trezor signPSBT called', {
      psbtLength: request.psbt.length,
      inputPathsCount: request.inputPaths?.length || 0,
    });

    try {
      const psbt = bitcoin.Psbt.fromBase64(request.psbt);

      // Determine script type
      let scriptType: 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT' = 'SPENDWITNESS';
      if (request.accountPath) {
        scriptType = getTrezorScriptType(request.accountPath);
      } else if (request.inputPaths && request.inputPaths.length > 0) {
        scriptType = getTrezorScriptType(request.inputPaths[0]);
      }

      // Determine coin based on path
      const isTestnet = (request.accountPath || request.inputPaths?.[0] || '').includes("/1'/");
      const coin = isTestnet ? 'Testnet' : 'Bitcoin';

      // Build Trezor inputs
      const inputs = psbt.data.inputs.map((input, idx) => {
        let addressN: number[] = [];
        if (input.bip32Derivation && input.bip32Derivation.length > 0) {
          addressN = pathToAddressN(input.bip32Derivation[0].path);
        } else if (request.inputPaths && request.inputPaths[idx]) {
          addressN = pathToAddressN(request.inputPaths[idx]);
        }

        const txInput = psbt.txInputs[idx];
        const prevHash = Buffer.from(txInput.hash).reverse().toString('hex');

        const trezorInput: any = {
          address_n: addressN,
          prev_hash: prevHash,
          prev_index: txInput.index,
          sequence: txInput.sequence,
          script_type: scriptType,
        };

        if (input.witnessUtxo) {
          trezorInput.amount = input.witnessUtxo.value.toString();
        }

        return trezorInput;
      });

      // Build Trezor outputs
      const outputs = psbt.txOutputs.map((output, idx) => {
        const psbtOutput = psbt.data.outputs[idx];
        const isChange = request.changeOutputs?.includes(idx) ||
          (psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0);

        if (isChange && psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0) {
          const outputScriptType = scriptType === 'SPENDADDRESS' ? 'PAYTOADDRESS' :
            scriptType === 'SPENDP2SHWITNESS' ? 'PAYTOP2SHWITNESS' :
            scriptType === 'SPENDTAPROOT' ? 'PAYTOTAPROOT' : 'PAYTOWITNESS';

          return {
            address_n: pathToAddressN(psbtOutput.bip32Derivation[0].path),
            amount: output.value.toString(),
            script_type: outputScriptType,
          };
        } else {
          const address = bitcoin.address.fromOutputScript(
            output.script,
            isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
          );

          return {
            address,
            amount: output.value.toString(),
            script_type: 'PAYTOADDRESS',
          };
        }
      });

      // Fetch reference transactions
      const refTxs = await fetchRefTxs(psbt);

      log.info('Calling TrezorConnect.signTransaction', {
        inputCount: inputs.length,
        outputCount: outputs.length,
        refTxCount: refTxs.length,
        coin,
      });

      // Sign with Trezor
      const result = await TrezorConnect.signTransaction({
        inputs,
        outputs,
        refTxs: refTxs.length > 0 ? refTxs : undefined,
        coin,
        push: false,
      });

      if (!result.success) {
        const errorMsg = 'error' in result.payload ? result.payload.error : 'Signing failed';
        throw new Error(errorMsg);
      }

      log.info('Trezor signing successful', {
        signedTxLength: result.payload.serializedTx?.length,
      });

      // Trezor returns fully signed raw transaction
      const signedTxHex = result.payload.serializedTx;

      return {
        psbt: psbt.toBase64(), // Original PSBT for reference
        rawTx: signedTxHex, // Fully signed transaction ready to broadcast
        signatures: inputs.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Trezor signing failed', { error: message });

      if (message.includes('Cancelled') || message.includes('cancelled') || message.includes('rejected')) {
        throw new Error('Transaction rejected on Trezor. Please approve the transaction on your device.');
      }
      if (message.includes('PIN')) {
        throw new Error('Incorrect PIN. Please try again.');
      }
      if (message.includes('Passphrase')) {
        throw new Error('Passphrase entry cancelled.');
      }
      if (message.includes('Device disconnected') || message.includes('no device')) {
        throw new Error('Trezor disconnected. Please reconnect and try again.');
      }

      throw new Error(`Failed to sign with Trezor: ${message}`);
    }
  }
}
