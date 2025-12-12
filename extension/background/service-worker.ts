// Background service worker for Sanctuary Hardware Wallet Bridge
// Handles device communication and message passing between content scripts and devices

import { deviceManager, registerDriver } from '../lib/devices';
import { ledgerDriver } from '../lib/ledger';
import { trezorDriver } from '../lib/trezor';
import type {
  BackgroundMessage,
  MessageResponse,
  HWDevice,
  XpubResult,
  SignPSBTResult,
  DeviceType,
} from '../types/messages';

// Register device drivers
registerDriver(ledgerDriver);
registerDriver(trezorDriver);

// Store for tracking device state changes
let lastKnownDevices: HWDevice[] = [];

// Broadcast device changes to all connected tabs
function broadcastDeviceUpdate(devices: HWDevice[]): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'DEVICE_UPDATE',
          devices,
        }).catch(() => {
          // Tab might not have content script, ignore
        });
      }
    }
  });
}

// Subscribe to device changes
deviceManager.onDeviceChange((devices) => {
  lastKnownDevices = devices;
  broadcastDeviceUpdate(devices);

  // Also update the badge
  updateBadge(devices);
});

// Update extension badge with device count
function updateBadge(devices: HWDevice[]): void {
  const connectedCount = devices.filter(d => d.connected).length;

  if (connectedCount > 0) {
    chrome.action.setBadgeText({ text: String(connectedCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }); // Green
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    // Verify the sender is from an allowed origin
    if (sender.tab?.url) {
      const url = new URL(sender.tab.url);
      const allowedOrigins = [
        'localhost',
        '127.0.0.1',
        'sanctuary.local',
      ];

      const isAllowed = allowedOrigins.some(
        origin => url.hostname === origin || url.hostname.endsWith(`.${origin}`)
      );

      if (!isAllowed) {
        sendResponse({
          success: false,
          error: 'Origin not allowed',
        });
        return false;
      }
    }

    // Handle the message asynchronously
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message || 'Unknown error',
        });
      });

    // Return true to indicate async response
    return true;
  }
);

// Main message handler
async function handleMessage(message: BackgroundMessage): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_STATUS':
      return {
        success: true,
        data: {
          devices: lastKnownDevices,
          supported: {
            ledger: ledgerDriver.isSupported(),
            trezor: trezorDriver.isSupported(),
          },
        },
      };

    case 'GET_DEVICES':
      try {
        const devices = await deviceManager.enumerateAll();
        lastKnownDevices = devices;
        return {
          success: true,
          data: devices,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to enumerate devices',
        };
      }

    case 'CONNECT_DEVICE':
      try {
        const deviceType = message.payload.deviceType as DeviceType;
        const device = await deviceManager.connectDevice(deviceType);
        return {
          success: true,
          data: device,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to connect device',
        };
      }

    case 'DISCONNECT_DEVICE':
      try {
        await deviceManager.disconnectDevice(message.payload.deviceId);
        return {
          success: true,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to disconnect device',
        };
      }

    case 'GET_XPUB':
      try {
        const { path, deviceId } = message.payload;

        // If no device ID specified, use the first connected device
        let targetDeviceId = deviceId;
        if (!targetDeviceId) {
          const devices = deviceManager.getConnectedDevices();
          if (devices.length === 0) {
            throw new Error('No device connected');
          }
          targetDeviceId = devices[0].id;
        }

        const result: XpubResult = await deviceManager.getXpub(targetDeviceId, path);
        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to get xpub',
        };
      }

    case 'SIGN_PSBT':
      try {
        const { psbt, inputPaths, deviceId } = message.payload;

        // If no device ID specified, use the first connected device
        let targetDeviceId = deviceId;
        if (!targetDeviceId) {
          const devices = deviceManager.getConnectedDevices();
          if (devices.length === 0) {
            throw new Error('No device connected');
          }
          targetDeviceId = devices[0].id;
        }

        const result: SignPSBTResult = await deviceManager.signPSBT(
          targetDeviceId,
          psbt,
          inputPaths
        );
        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to sign PSBT',
        };
      }

    case 'VERIFY_ADDRESS':
      try {
        const { path, address, deviceId } = message.payload;

        let targetDeviceId = deviceId;
        if (!targetDeviceId) {
          const devices = deviceManager.getConnectedDevices();
          if (devices.length === 0) {
            throw new Error('No device connected');
          }
          targetDeviceId = devices[0].id;
        }

        const verified = await deviceManager.verifyAddress(targetDeviceId, path, address);
        return {
          success: true,
          data: verified,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to verify address',
        };
      }

    default:
      return {
        success: false,
        error: `Unknown message type: ${(message as any).type}`,
      };
  }
}

// Handle external connections (from the web page directly via externally_connectable)
chrome.runtime.onConnectExternal.addListener((port) => {
  console.log('External connection from:', port.sender?.url);

  port.onMessage.addListener(async (message: BackgroundMessage) => {
    try {
      const response = await handleMessage(message);
      port.postMessage(response);
    } catch (error: any) {
      port.postMessage({
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  });
});

// Periodic device check (every 5 seconds)
setInterval(async () => {
  try {
    const devices = await deviceManager.enumerateAll();
    const changed =
      devices.length !== lastKnownDevices.length ||
      devices.some((d, i) => d.id !== lastKnownDevices[i]?.id || d.connected !== lastKnownDevices[i]?.connected);

    if (changed) {
      lastKnownDevices = devices;
      broadcastDeviceUpdate(devices);
      updateBadge(devices);
    }
  } catch (error) {
    console.error('Device enumeration error:', error);
  }
}, 5000);

// Log startup
console.log('Sanctuary HW Bridge service worker started');
