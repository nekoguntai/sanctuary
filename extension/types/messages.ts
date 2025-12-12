// Message types for communication between content script, background worker, and page

export type DeviceType = 'ledger' | 'trezor';

export interface HWDevice {
  id: string;
  type: DeviceType;
  model: string;
  fingerprint: string | null;
  connected: boolean;
  needsPin?: boolean;
  needsPassphrase?: boolean;
}

export interface XpubResult {
  xpub: string;
  fingerprint: string;
  path: string;
}

export interface SignPSBTRequest {
  psbt: string; // Base64 encoded PSBT
  inputPaths: string[]; // Derivation paths for each input
  deviceId?: string; // Optional specific device to use
}

export interface SignPSBTResult {
  signedPsbt: string;
  signatures: number;
}

export interface VerifyAddressRequest {
  path: string;
  address: string;
  deviceId?: string;
}

// Messages from content script to background worker
export type BackgroundMessage =
  | { type: 'GET_DEVICES' }
  | { type: 'GET_XPUB'; payload: { path: string; deviceId?: string } }
  | { type: 'SIGN_PSBT'; payload: SignPSBTRequest }
  | { type: 'VERIFY_ADDRESS'; payload: VerifyAddressRequest }
  | { type: 'CONNECT_DEVICE'; payload: { deviceType: DeviceType } }
  | { type: 'DISCONNECT_DEVICE'; payload: { deviceId: string } }
  | { type: 'GET_STATUS' };

// Response wrapper
export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Events from background to content script / popup
export type BackgroundEvent =
  | { type: 'DEVICE_CONNECTED'; device: HWDevice }
  | { type: 'DEVICE_DISCONNECTED'; deviceId: string }
  | { type: 'SIGNING_PROGRESS'; progress: string }
  | { type: 'STATUS_UPDATE'; devices: HWDevice[] };

// Bridge API exposed to the page via window.sanctuaryHWBridge
export interface SanctuaryHWBridge {
  isAvailable: true;
  version: string;
  getDevices(): Promise<HWDevice[]>;
  getXpub(path: string, deviceId?: string): Promise<XpubResult>;
  signPSBT(psbt: string, inputPaths: string[], deviceId?: string): Promise<SignPSBTResult>;
  verifyAddress(path: string, address: string, deviceId?: string): Promise<boolean>;
  connectDevice(deviceType: DeviceType): Promise<HWDevice>;
  onDeviceChange(callback: (devices: HWDevice[]) => void): () => void;
}

// Extend window type for TypeScript
declare global {
  interface Window {
    sanctuaryHWBridge?: SanctuaryHWBridge;
  }
}
