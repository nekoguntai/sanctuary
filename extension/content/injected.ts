// Injected script - runs in the page context and exposes window.sanctuaryHWBridge
// This script is injected by the content script and communicates via window.postMessage

import type {
  SanctuaryHWBridge,
  HWDevice,
  XpubResult,
  SignPSBTResult,
  DeviceType,
} from '../types/messages';

// Message ID counter for request/response matching
let messageId = 0;
const pendingRequests: Map<number, {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}> = new Map();

// Device change listeners
const deviceChangeListeners: Set<(devices: HWDevice[]) => void> = new Set();

// Default timeout for requests (30 seconds - signing can take time)
const REQUEST_TIMEOUT = 30000;

// Send a message to the content script and wait for response
function sendMessage<T>(type: string, payload?: any, timeout = REQUEST_TIMEOUT): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;

    const timeoutHandle = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Request timed out'));
    }, timeout);

    pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });

    window.postMessage({
      type: `SANCTUARY_HW_${type}`,
      id,
      payload,
    }, '*');
  });
}

// Listen for responses from the content script
window.addEventListener('message', (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const { type, id, success, data, error, devices } = event.data;

  // Handle device update events
  if (type === 'SANCTUARY_HW_DEVICE_UPDATE' && devices) {
    for (const listener of deviceChangeListeners) {
      try {
        listener(devices);
      } catch (e) {
        console.error('Device change listener error:', e);
      }
    }
    return;
  }

  // Handle request responses
  if (type?.endsWith('_RESPONSE') && id !== undefined) {
    const pending = pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(id);

      if (success) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(error || 'Unknown error'));
      }
    }
  }
});

// The bridge API exposed to the page
const sanctuaryHWBridge: SanctuaryHWBridge = {
  isAvailable: true,
  version: '1.0.0',

  async getDevices(): Promise<HWDevice[]> {
    return sendMessage<HWDevice[]>('GET_DEVICES');
  },

  async getXpub(path: string, deviceId?: string): Promise<XpubResult> {
    return sendMessage<XpubResult>('GET_XPUB', { path, deviceId });
  },

  async signPSBT(
    psbt: string,
    inputPaths: string[],
    deviceId?: string
  ): Promise<SignPSBTResult> {
    // Signing can take longer - use 60 second timeout
    return sendMessage<SignPSBTResult>(
      'SIGN_PSBT',
      { psbt, inputPaths, deviceId },
      60000
    );
  },

  async verifyAddress(
    path: string,
    address: string,
    deviceId?: string
  ): Promise<boolean> {
    return sendMessage<boolean>('VERIFY_ADDRESS', { path, address, deviceId });
  },

  async connectDevice(deviceType: DeviceType): Promise<HWDevice> {
    return sendMessage<HWDevice>('CONNECT_DEVICE', { deviceType });
  },

  onDeviceChange(callback: (devices: HWDevice[]) => void): () => void {
    deviceChangeListeners.add(callback);
    return () => deviceChangeListeners.delete(callback);
  },
};

// Expose the bridge on the window object
(window as any).sanctuaryHWBridge = sanctuaryHWBridge;

// Dispatch event to notify that the bridge is ready
window.dispatchEvent(new CustomEvent('sanctuaryHWBridgeReady', {
  detail: { version: '1.0.0' },
}));

console.log('Sanctuary HW Bridge API injected');
