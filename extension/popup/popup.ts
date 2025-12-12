// Popup script for Sanctuary Hardware Wallet Bridge

interface HWDevice {
  id: string;
  type: 'ledger' | 'trezor';
  model: string;
  fingerprint: string | null;
  connected: boolean;
  needsPin?: boolean;
  needsPassphrase?: boolean;
}

interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface StatusData {
  devices: HWDevice[];
  supported: {
    ledger: boolean;
    trezor: boolean;
  };
}

// DOM elements
const statusIndicator = document.getElementById('status-indicator')!;
const statusDot = statusIndicator.querySelector('.status-dot')!;
const statusText = statusIndicator.querySelector('.status-text')!;
const devicesList = document.getElementById('devices-list')!;
const connectLedgerBtn = document.getElementById('connect-ledger') as HTMLButtonElement;
const connectTrezorBtn = document.getElementById('connect-trezor') as HTMLButtonElement;

// State
let currentDevices: HWDevice[] = [];
let supported = { ledger: false, trezor: false };

// Send message to background service worker
async function sendMessage<T>(type: string, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response: MessageResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response.success) {
        resolve(response.data as T);
      } else {
        reject(new Error(response.error || 'Unknown error'));
      }
    });
  });
}

// Update the status indicator
function updateStatus(devices: HWDevice[]): void {
  const connectedCount = devices.filter(d => d.connected).length;

  if (connectedCount > 0) {
    statusDot.classList.add('connected');
    statusDot.classList.remove('disconnected');
    statusText.textContent = `${connectedCount} device${connectedCount > 1 ? 's' : ''} connected`;
  } else {
    statusDot.classList.remove('connected');
    statusDot.classList.add('disconnected');
    statusText.textContent = 'No devices connected';
  }
}

// Render the devices list
function renderDevices(devices: HWDevice[]): void {
  if (devices.length === 0) {
    devicesList.innerHTML = '<p class="no-devices">No devices connected</p>';
    return;
  }

  devicesList.innerHTML = devices.map(device => `
    <div class="device-item">
      <div class="device-info">
        <div class="device-icon ${device.type}">
          ${device.type === 'ledger' ? 'L' : 'T'}
        </div>
        <div class="device-details">
          <span class="device-name">${device.model}</span>
          ${device.fingerprint ? `<span class="device-fingerprint">${device.fingerprint}</span>` : ''}
        </div>
      </div>
      <span class="device-status ${device.connected ? '' : 'disconnected'}">
        ${device.connected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  `).join('');
}

// Show error message
function showError(message: string): void {
  // Remove any existing error
  const existingError = document.querySelector('.error-message');
  if (existingError) {
    existingError.remove();
  }

  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;

  // Insert after the connect buttons
  const connectSection = document.querySelector('.connect-section');
  if (connectSection) {
    connectSection.appendChild(errorDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }
}

// Connect to a device
async function connectDevice(type: 'ledger' | 'trezor'): Promise<void> {
  const btn = type === 'ledger' ? connectLedgerBtn : connectTrezorBtn;
  const originalText = btn.querySelector('span:last-child')!.textContent;

  try {
    btn.disabled = true;
    btn.querySelector('span:last-child')!.textContent = 'Connecting...';

    const device = await sendMessage<HWDevice>('CONNECT_DEVICE', { deviceType: type });

    // Add to devices list
    const existingIndex = currentDevices.findIndex(d => d.id === device.id);
    if (existingIndex >= 0) {
      currentDevices[existingIndex] = device;
    } else {
      currentDevices.push(device);
    }

    updateStatus(currentDevices);
    renderDevices(currentDevices);
  } catch (error: any) {
    showError(error.message || `Failed to connect ${type}`);
  } finally {
    btn.disabled = false;
    btn.querySelector('span:last-child')!.textContent = originalText;
  }
}

// Initialize the popup
async function init(): Promise<void> {
  try {
    // Get current status
    const status = await sendMessage<StatusData>('GET_STATUS');

    supported = status.supported;
    currentDevices = status.devices;

    // Update UI
    updateStatus(currentDevices);
    renderDevices(currentDevices);

    // Disable unsupported buttons
    connectLedgerBtn.disabled = !supported.ledger;
    connectTrezorBtn.disabled = !supported.trezor;

    if (!supported.ledger) {
      connectLedgerBtn.title = 'WebUSB not supported in this browser';
    }
    if (!supported.trezor) {
      connectTrezorBtn.title = 'Trezor Connect not supported';
    }
  } catch (error: any) {
    statusText.textContent = 'Extension error';
    showError(error.message || 'Failed to initialize');
  }
}

// Event listeners
connectLedgerBtn.addEventListener('click', () => connectDevice('ledger'));
connectTrezorBtn.addEventListener('click', () => connectDevice('trezor'));

// Listen for device updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'DEVICE_UPDATE') {
    currentDevices = message.devices;
    updateStatus(currentDevices);
    renderDevices(currentDevices);
  }
});

// Initialize on load
init();
