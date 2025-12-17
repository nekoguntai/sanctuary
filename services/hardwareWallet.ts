/**
 * Hardware Wallet Integration Service
 *
 * Provides browser-based hardware wallet integration for signing Bitcoin transactions.
 * Uses native WebUSB API for direct communication with Ledger devices.
 * Requires HTTPS for WebUSB to work in the browser.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import AppBtc from '@ledgerhq/hw-app-btc';
import { AppClient, DefaultWalletPolicy, PsbtV2 } from 'ledger-bitcoin';
import TrezorConnect, { DEVICE_EVENT, DEVICE } from '@trezor/connect-web';
import * as bitcoin from 'bitcoinjs-lib';
import apiClient from '../src/api/client';
import { createLogger } from '../utils/logger';

const log = createLogger('HardwareWallet');

// =============================================================================
// TREZOR INTEGRATION (Bridge Mode - supports Safe 7 and all Trezor devices)
// =============================================================================

interface TrezorConnection {
  initialized: boolean;
  connected: boolean;
  deviceId?: string;
  fingerprint?: string;
  model?: string;
  label?: string;
}

let trezorConnection: TrezorConnection = {
  initialized: false,
  connected: false,
};

/**
 * Initialize Trezor Connect with bridge mode configuration
 * Bridge mode uses Trezor Suite desktop app for communication
 * This is required for Safe 7 and provides better stability for all devices
 */
export const initializeTrezor = async (): Promise<void> => {
  if (trezorConnection.initialized) {
    log.info('Trezor already initialized');
    return;
  }

  try {
    await TrezorConnect.init({
      manifest: {
        email: 'support@sanctuary.bitcoin',
        appUrl: window.location.origin || 'https://sanctuary.bitcoin',
        // appName is REQUIRED for the new Trezor Suite flow (Safe 7)
        appName: 'Sanctuary',
      },
      // Use auto mode - TrezorConnect will detect Trezor Suite's WebSocket
      // and route requests through it (required for Safe 7)
      coreMode: 'auto',
      debug: true, // Enable debug to see what's happening
      lazyLoad: false,
    });

    trezorConnection.initialized = true;
    log.info('Trezor Connect initialized with bridge mode');
  } catch (error) {
    log.error('Failed to initialize Trezor Connect', { error });
    throw new Error('Failed to initialize Trezor. Please ensure Trezor Suite is running.');
  }
};

/**
 * Connect to a Trezor device via Trezor Suite bridge
 */
export const connectTrezorDevice = async (): Promise<HardwareWalletDevice> => {
  if (!trezorConnection.initialized) {
    await initializeTrezor();
  }

  try {
    log.info('Requesting Trezor device features...');

    // Get device features to verify connection and get fingerprint
    const result = await TrezorConnect.getFeatures();

    log.info('Trezor getFeatures response', {
      success: result.success,
      payload: result.success ? 'features received' : result.payload
    });

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

    trezorConnection = {
      initialized: true,
      connected: true,
      deviceId: features.device_id || undefined,
      fingerprint,
      model: modelName,
      label: features.label || undefined,
    };

    log.info('Trezor connected', {
      model: modelName,
      label: features.label,
      fingerprint,
    });

    return {
      id: `trezor-${features.device_id || 'unknown'}`,
      type: 'trezor',
      name: features.label || modelName,
      model: modelName,
      connected: true,
      fingerprint,
      needsPin: features.pin_protection && !features.unlocked,
      needsPassphrase: features.passphrase_protection,
    };
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
};

/**
 * Get extended public key from Trezor
 */
export const getTrezorXpub = async (path: string): Promise<XpubResult> => {
  if (!trezorConnection.connected) {
    throw new Error('Trezor not connected');
  }

  try {
    // Determine coin type for proper xpub format
    const isTestnet = path.includes("/1'/") || path.includes("/1h/");

    const result = await TrezorConnect.getPublicKey({
      path,
      showOnTrezor: false,
      coin: isTestnet ? 'Testnet' : 'Bitcoin',
    });

    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to get public key');
    }

    const { xpub, fingerprint } = result.payload;
    const fpHex = fingerprint?.toString(16).padStart(8, '0') || trezorConnection.fingerprint || '';

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
};

/**
 * Determine Trezor script type from BIP path
 */
const getTrezorScriptType = (path: string): 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT' => {
  if (path.startsWith("m/44'") || path.startsWith("44'")) {
    return 'SPENDADDRESS'; // Legacy P2PKH
  }
  if (path.startsWith("m/49'") || path.startsWith("49'")) {
    return 'SPENDP2SHWITNESS'; // Nested SegWit P2SH-P2WPKH
  }
  if (path.startsWith("m/84'") || path.startsWith("84'")) {
    return 'SPENDWITNESS'; // Native SegWit P2WPKH
  }
  if (path.startsWith("m/86'") || path.startsWith("86'")) {
    return 'SPENDTAPROOT'; // Taproot P2TR
  }
  return 'SPENDWITNESS'; // Default to native segwit
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
    // Get the previous transaction ID from the unsigned tx
    const txInput = psbt.txInputs[psbt.data.inputs.indexOf(input)];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');

    if (seenTxids.has(txid)) continue;
    seenTxids.add(txid);

    try {
      // Fetch the raw transaction from backend
      const response = await apiClient.get<{ hex: string }>(`/transactions/${txid}/raw`);
      const rawTx = bitcoin.Transaction.fromHex(response.hex);

      // Convert to Trezor RefTransaction format
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
      // Continue without this ref tx - Trezor may still work for SegWit inputs
    }
  }

  return refTxs;
};

/**
 * Sign a PSBT with Trezor
 */
export const signPSBTWithTrezor = async (
  request: PSBTSignRequest
): Promise<PSBTSignResponse> => {
  if (!trezorConnection.connected) {
    throw new Error('Trezor not connected');
  }

  log.info('Trezor signPSBT called', {
    psbtLength: request.psbt.length,
    inputPathsCount: request.inputPaths?.length || 0,
  });

  try {
    const psbt = bitcoin.Psbt.fromBase64(request.psbt);

    // Determine script type from first input path or account path
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
      // Get derivation path
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

      // Add amount for SegWit inputs
      if (input.witnessUtxo) {
        trezorInput.amount = input.witnessUtxo.value.toString();
      }

      return trezorInput;
    });

    // Build Trezor outputs
    const outputs = psbt.txOutputs.map((output, idx) => {
      // Check if this is a change output (has bip32Derivation in output)
      const psbtOutput = psbt.data.outputs[idx];
      const isChange = request.changeOutputs?.includes(idx) ||
        (psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0);

      if (isChange && psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0) {
        // Change output - use address_n
        const outputScriptType = scriptType === 'SPENDADDRESS' ? 'PAYTOADDRESS' :
          scriptType === 'SPENDP2SHWITNESS' ? 'PAYTOP2SHWITNESS' :
          scriptType === 'SPENDTAPROOT' ? 'PAYTOTAPROOT' : 'PAYTOWITNESS';

        return {
          address_n: pathToAddressN(psbtOutput.bip32Derivation[0].path),
          amount: output.value.toString(),
          script_type: outputScriptType,
        };
      } else {
        // External output - use address
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

    // Fetch reference transactions (needed for legacy inputs, optional for SegWit)
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
      throw new Error(result.payload.error || 'Signing failed');
    }

    log.info('Trezor signing successful', {
      signedTxLength: result.payload.serializedTx?.length,
    });

    // Trezor returns the fully signed transaction hex
    // We need to create a new PSBT with the final transaction
    const signedTx = bitcoin.Transaction.fromHex(result.payload.serializedTx);

    // Apply signatures back to PSBT
    psbt.data.inputs.forEach((input, idx) => {
      const txInput = signedTx.ins[idx];
      if (txInput.witness && txInput.witness.length > 0) {
        psbt.updateInput(idx, {
          finalScriptWitness: bitcoin.script.compile(txInput.witness),
        });
      }
      if (txInput.script && txInput.script.length > 0) {
        psbt.updateInput(idx, {
          finalScriptSig: txInput.script,
        });
      }
    });

    // Finalize
    try {
      psbt.finalizeAllInputs();
    } catch {
      // Already finalized by Trezor
    }

    return {
      psbt: psbt.toBase64(),
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
};

/**
 * Disconnect Trezor
 */
export const disconnectTrezor = async (): Promise<void> => {
  trezorConnection = {
    initialized: trezorConnection.initialized,
    connected: false,
  };
  log.info('Trezor disconnected');
};

/**
 * Check if Trezor is connected
 */
export const isTrezorConnected = (): boolean => {
  return trezorConnection.connected;
};

/**
 * Get Trezor connection state
 */
export const getTrezorConnection = (): TrezorConnection => {
  return { ...trezorConnection };
};

// =============================================================================
// LEDGER INTEGRATION (WebUSB)
// =============================================================================

export type DeviceType = 'coldcard' | 'ledger' | 'trezor' | 'bitbox' | 'passport' | 'jade' | 'unknown';

export interface HardwareWalletDevice {
  id: string;
  type: DeviceType;
  name: string;
  model?: string;
  connected: boolean;
  fingerprint?: string;
  needsPin?: boolean;
  needsPassphrase?: boolean;
}

export interface PSBTSignRequest {
  psbt: string; // Base64 encoded PSBT
  inputPaths: string[]; // Derivation paths for inputs to sign
  changeOutputs?: number[]; // Indices of change outputs
  accountPath?: string; // Account derivation path (e.g., "m/84'/0'/0'")
  scriptType?: 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr'; // Script type for wallet policy
}

export interface PSBTSignResponse {
  psbt: string; // Base64 encoded signed PSBT
  signatures: number; // Number of signatures added
}

export interface TransactionForSigning {
  walletId: string;
  recipient: string;
  amount: number; // satoshis
  feeRate: number; // sat/vB
  utxos?: string[]; // Optional: specific UTXOs to use
  changeAddress?: string;
}

export interface XpubResult {
  xpub: string;
  fingerprint: string;
  path: string;
}

// Ledger USB vendor ID
const LEDGER_VENDOR_ID = 0x2c97;

// Connected device state
interface LedgerConnection {
  transport: TransportWebUSB;
  app: AppBtc;
  appClient: AppClient; // ledger-bitcoin AppClient for PSBT signing
  device: USBDevice;
}

let activeConnection: LedgerConnection | null = null;

/**
 * Check if WebUSB is supported in this browser
 */
export const isWebUSBSupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
};

/**
 * Check if we're in a secure context (HTTPS or localhost)
 */
export const isSecureContext = (): boolean => {
  return typeof window !== 'undefined' && window.isSecureContext;
};

/**
 * Check if hardware wallet integration is supported
 */
export const isHardwareWalletSupported = (): boolean => {
  return isWebUSBSupported() && isSecureContext();
};

/**
 * Get model name from Ledger product ID
 */
const getLedgerModel = (productId: number): string => {
  const models: Record<number, string> = {
    0x0001: 'Ledger Nano S',
    0x0004: 'Ledger Nano X',
    0x0005: 'Ledger Nano S Plus',
    0x0006: 'Ledger Stax',
    0x0007: 'Ledger Flex',
  };
  return models[productId] || 'Ledger Device';
};

/**
 * Get device ID from USB device
 */
const getDeviceId = (device: USBDevice): string => {
  return `ledger-${device.vendorId}-${device.productId}-${device.serialNumber || 'unknown'}`;
};

/**
 * Get list of previously authorized Ledger devices
 */
export const getConnectedDevices = async (): Promise<HardwareWalletDevice[]> => {
  if (!isWebUSBSupported()) {
    return [];
  }

  try {
    const devices = await navigator.usb.getDevices();
    const ledgerDevices = devices.filter(d => d.vendorId === LEDGER_VENDOR_ID);

    return ledgerDevices.map(device => ({
      id: getDeviceId(device),
      type: 'ledger' as DeviceType,
      name: getLedgerModel(device.productId),
      model: getLedgerModel(device.productId),
      connected: device.opened || (activeConnection?.device === device),
      fingerprint: undefined, // Will be set on connect
    }));
  } catch (error) {
    log.error('Failed to enumerate devices', { error });
    return [];
  }
};

/**
 * Request permission to connect to a Ledger device
 * Must be called in response to a user gesture (click)
 */
export const requestDevice = async (): Promise<HardwareWalletDevice | null> => {
  if (!isHardwareWalletSupported()) {
    throw new Error(
      'WebUSB is not supported. Please use Chrome/Edge on HTTPS.'
    );
  }

  try {
    // This will show the browser's device picker
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: LEDGER_VENDOR_ID }],
    });

    if (!device) {
      return null;
    }

    return {
      id: getDeviceId(device),
      type: 'ledger',
      name: getLedgerModel(device.productId),
      model: getLedgerModel(device.productId),
      connected: false,
      fingerprint: undefined,
    };
  } catch (error) {
    if ((error as Error).name === 'NotFoundError') {
      // User cancelled the picker
      return null;
    }
    throw error;
  }
};

/**
 * Connect to a Ledger device and open the Bitcoin app
 */
export const connectDevice = async (deviceId?: string): Promise<HardwareWalletDevice> => {
  if (!isHardwareWalletSupported()) {
    throw new Error('WebUSB is not supported in this browser');
  }

  // Close existing connection
  if (activeConnection) {
    try {
      await activeConnection.transport.close();
    } catch {
      // Ignore close errors
    }
    activeConnection = null;
  }

  try {
    // Create transport (will use existing permission or request new one)
    const transport = await TransportWebUSB.create();
    // Type assertion needed due to library type definitions
    const device = (transport as any).device as USBDevice;

    // Create Bitcoin app instances
    const app = new AppBtc({ transport });
    // Create ledger-bitcoin AppClient for PSBT signing
    const appClient = new AppClient(transport as any);

    // Get master fingerprint from the AppClient
    let fingerprint: string | undefined;
    try {
      fingerprint = await appClient.getMasterFingerprint();
      log.info('Got master fingerprint from device', { fingerprint });
    } catch (error) {
      log.warn('Could not get fingerprint - Bitcoin app may not be open', { error });
    }

    activeConnection = { transport: transport as any, app, appClient, device };

    return {
      id: getDeviceId(device),
      type: 'ledger',
      name: getLedgerModel(device.productId),
      model: getLedgerModel(device.productId),
      connected: true,
      fingerprint,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('denied') || message.includes('NotAllowed')) {
      throw new Error('Access denied. Please allow USB access and try again.');
    }
    if (message.includes('0x6d00') || message.includes('0x6e00')) {
      throw new Error('Please open the Bitcoin app on your Ledger device.');
    }
    if (message.includes('locked') || message.includes('0x6982')) {
      throw new Error('Ledger is locked. Please unlock with your PIN.');
    }

    throw new Error(`Failed to connect: ${message}`);
  }
};

/**
 * Disconnect from the active device
 */
export const disconnectDevice = async (): Promise<void> => {
  if (activeConnection) {
    try {
      await activeConnection.transport.close();
    } catch (error) {
      log.warn('Error closing transport', { error });
    }
    activeConnection = null;
  }
};

// xpub version bytes - Ledger always returns standard xpub format
const XPUB_VERSION = 0x0488b21e;  // Standard xpub (mainnet)
const TPUB_VERSION = 0x043587cf;  // Standard tpub (testnet)

/**
 * Get extended public key from the connected device
 */
export const getXpub = async (path: string): Promise<XpubResult> => {
  if (!activeConnection) {
    throw new Error('No device connected');
  }

  try {
    // Check if testnet path (coin type 1)
    const isTestnet = path.includes("/1'/") || path.includes("/1h/");
    const xpubVersion = isTestnet ? TPUB_VERSION : XPUB_VERSION;

    // getWalletXpub returns just the xpub string
    const xpub = await activeConnection.app.getWalletXpub({
      path,
      xpubVersion,
    });

    // Get master fingerprint from the AppClient
    let fingerprint = '';
    try {
      fingerprint = await activeConnection.appClient.getMasterFingerprint();
    } catch (fpError) {
      log.warn('Could not get fingerprint', { error: fpError });
    }

    log.info('getXpub result', {
      path,
      xpubVersion: xpubVersion.toString(16),
      hasXpub: !!xpub,
      xpubPrefix: xpub?.substring(0, 10),
      fingerprint,
    });

    return {
      xpub,
      fingerprint,
      path,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('0x6985') || message.includes('denied')) {
      throw new Error('Request rejected on device');
    }
    if (message.includes('0x6d00') || message.includes('0x6e00')) {
      throw new Error('Bitcoin app not open on device');
    }

    throw new Error(`Failed to get xpub: ${message}`);
  }
};

/**
 * Verify an address on the device display
 */
export const verifyAddress = async (path: string, address: string): Promise<boolean> => {
  if (!activeConnection) {
    throw new Error('No device connected');
  }

  try {
    // Display address on device for verification
    await activeConnection.app.getWalletPublicKey(path, { verify: true });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('0x6985') || message.includes('denied')) {
      return false; // User rejected
    }

    throw new Error(`Failed to verify address: ${message}`);
  }
};

/**
 * Get descriptor template for wallet policy based on script type
 */
const getDescriptorTemplate = (scriptType: string): 'wpkh(@0/**)' | 'sh(wpkh(@0/**))' | 'pkh(@0/**)' | 'tr(@0/**)' => {
  switch (scriptType) {
    case 'p2wpkh':
      return 'wpkh(@0/**)';
    case 'p2sh-p2wpkh':
      return 'sh(wpkh(@0/**))';
    case 'p2pkh':
      return 'pkh(@0/**)';
    case 'p2tr':
      return 'tr(@0/**)';
    default:
      return 'wpkh(@0/**)'; // Default to native segwit
  }
};

/**
 * Infer script type from derivation path
 */
const inferScriptTypeFromPath = (path: string): 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr' => {
  if (path.startsWith("m/84'") || path.startsWith("84'")) {
    return 'p2wpkh'; // BIP84 - Native SegWit
  }
  if (path.startsWith("m/49'") || path.startsWith("49'")) {
    return 'p2sh-p2wpkh'; // BIP49 - Wrapped SegWit
  }
  if (path.startsWith("m/44'") || path.startsWith("44'")) {
    return 'p2pkh'; // BIP44 - Legacy
  }
  if (path.startsWith("m/86'") || path.startsWith("86'")) {
    return 'p2tr'; // BIP86 - Taproot
  }
  return 'p2wpkh'; // Default to native segwit
};

/**
 * Extract account path from a full derivation path
 * e.g., "m/84'/0'/0'/0/5" -> "m/84'/0'/0'"
 */
const extractAccountPath = (fullPath: string): string => {
  const parts = fullPath.replace(/h/g, "'").split('/');
  // Account path is typically the first 4 parts: m/purpose'/coin'/account'
  if (parts.length >= 4) {
    return parts.slice(0, 4).join('/');
  }
  return fullPath;
};

/**
 * Sign a PSBT with the connected device using DefaultWalletPolicy
 *
 * For standard single-sig wallets (BIP44/49/84/86), this uses DefaultWalletPolicy
 * which doesn't require wallet registration on the device.
 */
export const signPSBT = async (
  request: PSBTSignRequest
): Promise<PSBTSignResponse> => {
  log.info('signPSBT called', {
    hasRequest: !!request,
    psbtLength: request?.psbt?.length || 0,
    inputPathsCount: request?.inputPaths?.length || 0,
    accountPath: request?.accountPath,
    scriptType: request?.scriptType,
  });

  if (!activeConnection) {
    log.error('No active connection');
    throw new Error('No device connected');
  }

  log.info('Active connection exists', {
    hasAppClient: !!activeConnection.appClient,
    hasApp: !!activeConnection.app,
  });

  try {
    const { appClient } = activeConnection;

    // First, parse the PSBT to extract actual derivation paths from inputs
    const tempPsbt = bitcoin.Psbt.fromBase64(request.psbt);
    let detectedAccountPath: string | null = null;

    // Try to extract account path from PSBT's bip32Derivation
    for (const input of tempPsbt.data.inputs) {
      if (input.bip32Derivation && input.bip32Derivation.length > 0) {
        const fullPath = input.bip32Derivation[0].path;
        if (fullPath) {
          // Extract account path from full path (e.g., "m/44'/0'/0'/0/0" -> "m/44'/0'/0'")
          detectedAccountPath = extractAccountPath(fullPath);
          console.log('[HardwareWallet] Detected account path from PSBT:', detectedAccountPath);
          break;
        }
      }
    }

    // Determine account path and script type
    let accountPath = request.accountPath || detectedAccountPath;
    let scriptType = request.scriptType;

    // If still not determined, try to infer from input paths parameter
    if (!accountPath && request.inputPaths && request.inputPaths.length > 0) {
      accountPath = extractAccountPath(request.inputPaths[0]);
    }
    if (!accountPath) {
      accountPath = "m/84'/0'/0'"; // Default to BIP84 mainnet
    }

    if (!scriptType) {
      scriptType = inferScriptTypeFromPath(accountPath);
    }

    console.log('[HardwareWallet] Using account path:', accountPath, 'script type:', scriptType);
    log.info('Preparing to sign PSBT', {
      psbtLength: request.psbt.length,
      inputPathsCount: request.inputPaths?.length || 0,
      accountPath,
      scriptType,
      detectedFromPsbt: !!detectedAccountPath,
    });

    // Get master fingerprint (returns hex string directly)
    log.info('Getting master fingerprint from device...');
    let masterFpHex: string;
    try {
      masterFpHex = await appClient.getMasterFingerprint();
      log.info('Got master fingerprint', { masterFpHex });
    } catch (fpError) {
      log.error('Failed to get master fingerprint', { error: fpError });
      throw fpError;
    }

    // Get account xpub
    log.info('Getting extended pubkey for path', { accountPath });
    let xpub: string;
    try {
      xpub = await appClient.getExtendedPubkey(accountPath);
      log.info('Got xpub', { xpubPrefix: xpub.substring(0, 20) });
    } catch (xpubError) {
      log.error('Failed to get xpub', { error: xpubError, accountPath });
      throw xpubError;
    }

    log.info('Got wallet info for signing', {
      masterFingerprint: masterFpHex,
      xpubPrefix: xpub.substring(0, 15),
      accountPath,
    });

    // Create wallet policy key string
    // Format: [fingerprint/path]xpub
    const pathWithoutM = accountPath.replace(/^m\//, '');
    const keyInfo = `[${masterFpHex}/${pathWithoutM}]${xpub}`;

    // Create DefaultWalletPolicy for standard single-sig wallet
    const descriptorTemplate = getDescriptorTemplate(scriptType);
    const walletPolicy = new DefaultWalletPolicy(descriptorTemplate, keyInfo);

    console.log('[HardwareWallet] Created wallet policy:', {
      descriptorTemplate,
      keyInfo,
    });
    log.info('Created wallet policy', {
      descriptorTemplate,
      keyInfo,
    });

    // Parse the PSBT using bitcoinjs-lib to inspect and potentially fix it
    const psbt = bitcoin.Psbt.fromBase64(request.psbt);
    const connectedFpBuffer = Buffer.from(masterFpHex, 'hex');

    // Use console.log directly to ensure visibility
    console.log('[HardwareWallet] PSBT has', psbt.data.inputs.length, 'inputs');

    // Log PSBT input details and fix fingerprint mismatches
    let fingerprintMismatchFixed = false;
    let missingBip32Derivation = false;

    psbt.data.inputs.forEach((input, idx) => {
      const inputInfo = {
        hasWitnessUtxo: !!input.witnessUtxo,
        witnessUtxoValue: input.witnessUtxo?.value,
        hasNonWitnessUtxo: !!input.nonWitnessUtxo,
        hasBip32Derivation: !!input.bip32Derivation && input.bip32Derivation.length > 0,
        bip32DerivationCount: input.bip32Derivation?.length || 0,
      };

      console.log(`[HardwareWallet] PSBT Input ${idx}:`, inputInfo);
      log.info(`PSBT Input ${idx} details`, inputInfo);

      if (!input.bip32Derivation || input.bip32Derivation.length === 0) {
        missingBip32Derivation = true;
        console.warn(`[HardwareWallet] Input ${idx} is MISSING bip32Derivation - Ledger will reject this!`);
        log.warn(`Input ${idx} is missing bip32Derivation`);
      }

      // Log and fix bip32Derivation details if present
      if (input.bip32Derivation && input.bip32Derivation.length > 0) {
        input.bip32Derivation.forEach((deriv, dIdx) => {
          const fpHex = deriv.masterFingerprint.toString('hex');
          const matches = fpHex.toLowerCase() === masterFpHex.toLowerCase();

          const derivInfo = {
            masterFingerprint: fpHex,
            connectedFingerprint: masterFpHex,
            pubkey: deriv.pubkey.toString('hex'),
            path: deriv.path,
            fingerprintMatches: matches,
          };
          console.log(`[HardwareWallet]   Derivation ${dIdx}:`, derivInfo);
          log.info(`  Derivation ${dIdx}`, derivInfo);

          // If fingerprint doesn't match, update it to use connected device's fingerprint
          if (!matches) {
            console.warn(`[HardwareWallet] Updating fingerprint from ${fpHex} to ${masterFpHex} for input ${idx}`);
            log.warn(`Updating fingerprint from ${fpHex} to ${masterFpHex} for input ${idx}`);
            deriv.masterFingerprint = connectedFpBuffer;
            fingerprintMismatchFixed = true;
          }
        });
      }
    });

    if (fingerprintMismatchFixed) {
      console.log('[HardwareWallet] Fixed fingerprint mismatches in PSBT bip32Derivation');
      log.info('Fixed fingerprint mismatches in PSBT bip32Derivation');
    }

    if (missingBip32Derivation) {
      console.error('[HardwareWallet] CRITICAL: PSBT is missing bip32Derivation data - this is required for Ledger signing!');
      log.error('PSBT is missing bip32Derivation data - Ledger requires this');
    }

    // Use the potentially updated PSBT
    const updatedPsbtBase64 = psbt.toBase64();

    // Sign the PSBT using ledger-bitcoin
    // DefaultWalletPolicy doesn't require registration, so walletHMAC is null
    log.info('Calling appClient.signPsbt...', {
      psbtBase64Length: updatedPsbtBase64.length,
      walletPolicyName: walletPolicy.name,
      walletPolicyDescriptorTemplate: descriptorTemplate,
    });

    let signatures: [number, { pubkey: Buffer; signature: Buffer }][];
    try {
      signatures = await appClient.signPsbt(updatedPsbtBase64, walletPolicy, null);
    } catch (signError: any) {
      log.error('appClient.signPsbt failed', {
        error: signError?.message || signError,
        errorCode: signError?.statusCode,
        psbtBase64Preview: updatedPsbtBase64.substring(0, 100) + '...',
      });
      throw signError;
    }

    log.info('Got signatures from device', {
      signatureCount: signatures.length,
    });

    // Apply each signature to the PSBT
    for (const [inputIndex, partialSig] of signatures) {
      log.info('Applying signature', {
        inputIndex,
        pubkeyHex: partialSig.pubkey.toString('hex').substring(0, 20),
        signatureLength: partialSig.signature.length,
      });

      // Update the input with the partial signature
      psbt.updateInput(inputIndex, {
        partialSig: [{
          pubkey: partialSig.pubkey,
          signature: partialSig.signature,
        }],
      });
    }

    // Finalize all inputs
    psbt.finalizeAllInputs();

    log.info('PSBT signed and finalized successfully', {
      signatureCount: signatures.length,
    });

    // Return the signed PSBT as base64
    return {
      psbt: psbt.toBase64(),
      signatures: signatures.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('PSBT signing failed', { error: message });

    if (message.includes('0x6985') || message.includes('denied') || message.includes('rejected')) {
      throw new Error('Transaction rejected on device. Please approve the transaction on your Ledger.');
    }
    if (message.includes('0x6d00') || message.includes('0x6e00') || message.includes('CLA_NOT_SUPPORTED')) {
      throw new Error('Bitcoin app not open on device. Please open the Bitcoin app on your Ledger.');
    }
    if (message.includes('0x6982') || message.includes('locked')) {
      throw new Error('Device is locked. Please unlock your Ledger with your PIN.');
    }
    if (message.includes('No device')) {
      throw new Error('Device disconnected. Please reconnect your Ledger and try again.');
    }

    throw new Error(`Failed to sign transaction: ${message}`);
  }
};

/**
 * Create a PSBT for signing via the backend API
 */
export const createPSBTForSigning = async (
  tx: TransactionForSigning
): Promise<{ psbt: string; fee: number; inputPaths: string[] }> => {
  const response = await apiClient.post<{
    psbt: string;
    fee: number;
    inputPaths: string[];
  }>(`/wallets/${tx.walletId}/psbt/create`, {
    recipients: [{ address: tx.recipient, amount: tx.amount }],
    feeRate: tx.feeRate,
    utxoIds: tx.utxos,
    changeAddress: tx.changeAddress,
  });

  return response;
};

/**
 * Broadcast a signed PSBT to the Bitcoin network via the backend
 */
export const broadcastSignedPSBT = async (
  walletId: string,
  psbt: string
): Promise<{ txid: string }> => {
  const response = await apiClient.post<{ txid: string }>(
    `/wallets/${walletId}/psbt/broadcast`,
    { signedPsbt: psbt }
  );

  return response;
};

/**
 * Hardware Wallet Service Class
 *
 * Supports both Ledger (WebUSB) and Trezor (Suite Bridge) devices.
 * Automatically routes operations to the correct device implementation.
 */
export class HardwareWalletService {
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Check if hardware wallet is supported
   * @param type Optional device type - Trezor uses bridge (always works), Ledger needs WebUSB
   */
  isSupported(type?: DeviceType): boolean {
    if (type === 'trezor') {
      // Trezor uses bridge mode - works on any browser with Trezor Suite running
      return true;
    }
    // Ledger requires WebUSB
    return isHardwareWalletSupported();
  }

  /**
   * Check if a device is connected
   */
  isConnected(): boolean {
    if (this.connectedDevice?.type === 'trezor') {
      return isTrezorConnected();
    }
    return this.connectedDevice !== null && this.connectedDevice.connected;
  }

  /**
   * Get the connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Get all authorized devices (Ledger only - Trezor doesn't persist authorization)
   */
  async getDevices(): Promise<HardwareWalletDevice[]> {
    return getConnectedDevices();
  }

  /**
   * Request permission and connect to a device
   * @param type Device type - 'trezor' uses Trezor Suite bridge, others use WebUSB
   */
  async connect(type?: DeviceType): Promise<HardwareWalletDevice> {
    if (type === 'trezor') {
      // Connect via Trezor Suite bridge
      this.connectedDevice = await connectTrezorDevice();
      return this.connectedDevice;
    }

    // Default to Ledger WebUSB flow
    // First request permission
    const device = await requestDevice();
    if (!device) {
      throw new Error('No device selected');
    }

    // Then connect
    this.connectedDevice = await connectDevice();
    return this.connectedDevice;
  }

  /**
   * Connect to Trezor device specifically
   * Uses Trezor Suite bridge for Safe 7 compatibility
   */
  async connectTrezor(): Promise<HardwareWalletDevice> {
    this.connectedDevice = await connectTrezorDevice();
    return this.connectedDevice;
  }

  /**
   * Connect to an already authorized Ledger device
   */
  async connectAuthorized(): Promise<HardwareWalletDevice> {
    this.connectedDevice = await connectDevice();
    return this.connectedDevice;
  }

  /**
   * Disconnect from the device
   */
  async disconnect(): Promise<void> {
    if (this.connectedDevice?.type === 'trezor') {
      await disconnectTrezor();
    } else {
      await disconnectDevice();
    }
    this.connectedDevice = null;
  }

  /**
   * Get xpub from device
   * Routes to Trezor or Ledger based on connected device
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (this.connectedDevice?.type === 'trezor') {
      return getTrezorXpub(path);
    }
    return getXpub(path);
  }

  /**
   * Verify address on device
   */
  async verifyAddress(path: string, address: string): Promise<boolean> {
    // TODO: Add Trezor address verification
    return verifyAddress(path, address);
  }

  /**
   * Sign a PSBT
   * Routes to Trezor or Ledger based on connected device
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (this.connectedDevice?.type === 'trezor') {
      return signPSBTWithTrezor(request);
    }
    return signPSBT(request);
  }

  /**
   * Full transaction signing flow
   */
  async signTransaction(tx: TransactionForSigning): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('No device connected');
    }

    // Create PSBT
    const { psbt, inputPaths } = await createPSBTForSigning(tx);

    // Sign (will route to correct device)
    const signed = await this.signPSBT({ psbt, inputPaths });

    // Broadcast
    const result = await broadcastSignedPSBT(tx.walletId, signed.psbt);

    return result.txid;
  }
}

// Export singleton
export const hardwareWalletService = new HardwareWalletService();
