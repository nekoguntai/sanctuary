// Content script - bridges the web page to the background service worker
// This script runs in the content script context and can communicate with both
// the page (via window messaging) and the extension (via chrome.runtime)

import type {
  HWDevice,
  XpubResult,
  SignPSBTResult,
  MessageResponse,
  DeviceType,
} from '../types/messages';

// Inject the page-facing API script
function injectScript(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/injected.js');
  script.onload = function () {
    (this as HTMLScriptElement).remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Message ID counter for request/response matching
let messageId = 0;
const pendingRequests: Map<number, {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}> = new Map();

// Send message to background and wait for response
async function sendToBackground<T>(type: string, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type, payload },
      (response: MessageResponse<T>) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response.success) {
          resolve(response.data as T);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      }
    );
  });
}

// Listen for messages from the injected page script
window.addEventListener('message', async (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const { type, id, payload } = event.data;

  // Only handle messages intended for the extension
  if (!type?.startsWith('SANCTUARY_HW_')) return;

  try {
    let result: any;

    switch (type) {
      case 'SANCTUARY_HW_GET_DEVICES':
        result = await sendToBackground<HWDevice[]>('GET_DEVICES');
        break;

      case 'SANCTUARY_HW_CONNECT_DEVICE':
        result = await sendToBackground<HWDevice>('CONNECT_DEVICE', payload);
        break;

      case 'SANCTUARY_HW_DISCONNECT_DEVICE':
        result = await sendToBackground<void>('DISCONNECT_DEVICE', payload);
        break;

      case 'SANCTUARY_HW_GET_XPUB':
        result = await sendToBackground<XpubResult>('GET_XPUB', payload);
        break;

      case 'SANCTUARY_HW_SIGN_PSBT':
        result = await sendToBackground<SignPSBTResult>('SIGN_PSBT', payload);
        break;

      case 'SANCTUARY_HW_VERIFY_ADDRESS':
        result = await sendToBackground<boolean>('VERIFY_ADDRESS', payload);
        break;

      case 'SANCTUARY_HW_GET_STATUS':
        result = await sendToBackground<any>('GET_STATUS');
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // Send success response back to page
    window.postMessage({
      type: `${type}_RESPONSE`,
      id,
      success: true,
      data: result,
    }, '*');
  } catch (error: any) {
    // Send error response back to page
    window.postMessage({
      type: `${type}_RESPONSE`,
      id,
      success: false,
      error: error.message || 'Unknown error',
    }, '*');
  }
});

// Listen for device updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'DEVICE_UPDATE') {
    // Forward device updates to the page
    window.postMessage({
      type: 'SANCTUARY_HW_DEVICE_UPDATE',
      devices: message.devices,
    }, '*');
  }
});

// Inject the script when the content script loads
injectScript();

// Notify the page that the extension is available
window.postMessage({
  type: 'SANCTUARY_HW_READY',
  version: '1.0.0',
}, '*');

console.log('Sanctuary HW Bridge content script loaded');
