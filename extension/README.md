# Sanctuary Hardware Wallet Bridge

Browser extension to connect USB hardware wallets (Ledger, Trezor) to the Sanctuary Bitcoin Wallet web application.

## Overview

This extension bridges the gap between hardware wallets connected via USB to your local machine and the Sanctuary web app running in Docker containers (locally or remotely).

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR LOCAL MACHINE                          │
│  ┌──────────────┐    ┌────────────────────────────────────┐    │
│  │ Ledger/Trezor│◄──►│  Browser Extension                 │    │
│  │   (USB)      │    │  - WebUSB/WebHID communication     │    │
│  └──────────────┘    │  - Signs PSBTs on device           │    │
│                      └─────────────┬──────────────────────┘    │
│                                    │                            │
│  ┌─────────────────────────────────▼────────────────────────┐  │
│  │  Browser Tab (localhost:8080 or remote)                  │  │
│  │  - Sanctuary React app                                   │  │
│  │  - Uses window.sanctuaryHWBridge API                     │  │
│  └─────────────────────────────────┬────────────────────────┘  │
└────────────────────────────────────│────────────────────────────┘
                                     │ HTTP/WebSocket
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              DOCKER CONTAINERS (Local or Remote)                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Nginx     │  │   Backend   │  │   PostgreSQL            │ │
│  │  (Frontend) │  │  (API/WS)   │  │   (Database)            │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Supported Devices

- **Ledger**: Nano S, Nano S Plus, Nano X, Stax, Flex
- **Trezor**: Model One, Model T, Safe 3, Safe 5

## Supported Origins

The extension automatically works with:

- `localhost` and `127.0.0.1` (local development)
- Private network IPs: `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`
- `*.sanctuary.local` and `*.sanctuary.lan`

Custom domains can be added in the extension options.

## Building the Extension

### Prerequisites

- Node.js 18+
- npm or yarn

### Build Steps

```bash
cd extension

# Install dependencies
npm install

# Build the extension
npm run package

# The built extension will be in the `dist` directory
```

### Development Mode

```bash
# Watch for changes and rebuild
npm run watch
```

## Installation

### Chrome / Chromium-based browsers

1. Build the extension (see above)
2. Open `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `extension/dist` directory

### Firefox (experimental)

Firefox support requires additional manifest changes for WebUSB compatibility.

## Usage

### 1. Install the Extension

Follow the installation steps above.

### 2. Connect Your Hardware Wallet

1. Plug in your Ledger or Trezor via USB
2. Unlock the device and open the Bitcoin app (for Ledger)
3. Click the extension icon to see connected devices

### 3. Use with Sanctuary

1. Open Sanctuary in your browser
2. The extension will automatically inject the bridge API
3. When sending transactions:
   - Sanctuary creates a PSBT
   - Extension prompts you to sign on your device
   - Review and approve the transaction on your hardware wallet
   - Sanctuary broadcasts the signed transaction

## Security

- The extension only communicates with whitelisted origins
- All signing happens on the hardware wallet device
- Private keys never leave the hardware wallet
- PSBTs can be verified on the device screen before signing

## API Reference

The extension injects `window.sanctuaryHWBridge` with the following methods:

```typescript
interface SanctuaryHWBridge {
  isAvailable: true;
  version: string;

  // Get list of connected devices
  getDevices(): Promise<HWDevice[]>;

  // Connect to a specific device type
  connectDevice(type: 'ledger' | 'trezor'): Promise<HWDevice>;

  // Get extended public key from device
  getXpub(path: string, deviceId?: string): Promise<XpubResult>;

  // Sign a PSBT
  signPSBT(
    psbt: string,
    inputPaths: string[],
    deviceId?: string
  ): Promise<{ signedPsbt: string; signatures: number }>;

  // Verify address on device display
  verifyAddress(
    path: string,
    address: string,
    deviceId?: string
  ): Promise<boolean>;

  // Subscribe to device connection changes
  onDeviceChange(callback: (devices: HWDevice[]) => void): () => void;
}
```

## Troubleshooting

### "Device not found"

1. Ensure your device is plugged in and unlocked
2. For Ledger: Open the Bitcoin app
3. Try disconnecting and reconnecting the USB cable
4. Check that no other application is using the device

### "Permission denied"

1. Chrome may need permission to access USB devices
2. Click the extension icon and use "Connect Device" button
3. Select your device in the browser's USB picker

### "Extension not detected"

1. Refresh the Sanctuary page after installing the extension
2. Check that the extension is enabled in `chrome://extensions`
3. Ensure you're accessing Sanctuary from an allowed origin

### "Signing failed"

1. Ensure the device is on the Bitcoin app (Ledger)
2. Check that the derivation paths match your wallet configuration
3. Verify the PSBT is valid and matches your wallet's UTXOs

## Development

### Project Structure

```
extension/
├── manifest.json          # Chrome extension manifest (MV3)
├── background/
│   └── service-worker.ts  # Background script (device management)
├── content/
│   ├── bridge.ts          # Content script (message passing)
│   └── injected.ts        # Page script (window.sanctuaryHWBridge)
├── lib/
│   ├── devices.ts         # Device driver abstraction
│   ├── ledger.ts          # Ledger-specific implementation
│   └── trezor.ts          # Trezor-specific implementation
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Popup styles
│   └── popup.ts           # Popup logic
├── options/
│   ├── options.html       # Options page
│   ├── options.css        # Options styles
│   └── options.ts         # Options logic
├── types/
│   └── messages.ts        # TypeScript type definitions
└── icons/                 # Extension icons
```

### Adding Support for New Devices

1. Create a new driver in `lib/` implementing the `DeviceDriver` interface
2. Register the driver in `background/service-worker.ts`
3. Add the device to the popup UI

## License

MIT
