# Hardware Wallet Integration

Technical documentation for Sanctuary's hardware wallet integration architecture.

## Architecture Overview

Sanctuary uses a **registry pattern** with pluggable adapters to support multiple hardware wallet vendors. This design enables adding new device support without modifying the core service.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (React)                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  HardwareWalletService                                          │ │
│  │  ├── registerAdapter(adapter)                                   │ │
│  │  ├── connect(type) → device                                     │ │
│  │  ├── getXpub(path) → xpub                                       │ │
│  │  └── signPSBT(request) → signed                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│              ┌───────────────┼───────────────┐                      │
│              ▼               ▼               ▼                      │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐          │
│  │ LedgerAdapter  │ │ TrezorAdapter  │ │ Future Adapter │          │
│  │  (WebUSB)      │ │  (Connect API) │ │  (WebHID, etc) │          │
│  └───────┬────────┘ └───────┬────────┘ └────────────────┘          │
│          │                  │                                        │
└──────────┼──────────────────┼────────────────────────────────────────┘
           │                  │
           ▼                  ▼
    ┌─────────────┐   ┌─────────────────────┐
    │ Ledger USB  │   │ connect.trezor.io   │
    │ (WebUSB)    │   │ (Trezor Connect)    │
    └─────────────┘   └─────────────────────┘
```

## Core Components

### File Structure

```
services/hardwareWallet/
├── index.ts              # Exports singleton service, registers adapters
├── service.ts            # HardwareWalletService class
├── types.ts              # TypeScript interfaces
└── adapters/
    ├── index.ts          # Adapter exports
    ├── ledger.ts         # Ledger WebUSB adapter
    └── trezor.ts         # Trezor Connect adapter
```

### DeviceAdapter Interface

All hardware wallet implementations must implement this interface:

```typescript
interface DeviceAdapter {
  readonly type: DeviceType;
  readonly displayName: string;

  isSupported(): boolean;
  isConnected(): boolean;
  getDevice(): HardwareWalletDevice | null;
  connect(): Promise<HardwareWalletDevice>;
  disconnect(): Promise<void>;
  getXpub(path: string): Promise<XpubResult>;
  signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse>;
  verifyAddress?(path: string, address: string): Promise<boolean>;
}
```

### PSBTSignResponse

Note that the response includes an optional `rawTx` field:

```typescript
interface PSBTSignResponse {
  psbt: string;       // Base64 PSBT (for reference)
  signatures: number; // Number of signatures added
  rawTx?: string;     // Fully signed raw transaction hex
}
```

This is important because **Trezor returns a fully signed raw transaction**, not a signed PSBT. The service layer handles both cases transparently.

---

## Trezor Integration

### Overview

The Trezor adapter uses **Trezor Connect** (`@trezor/connect-web`) to communicate with Trezor devices. Unlike Ledger which uses WebUSB directly, Trezor Connect handles device communication through the Trezor Suite bridge or desktop app.

### Supported Devices

| Device | Internal Model | Detection |
|--------|----------------|-----------|
| Trezor Model One | `1` | `features.model === '1'` |
| Trezor Model T | `T` | `features.model === 'T'` |
| Trezor Safe 3 | `T2B1` | `features.internal_model === 'T2B1'` |
| Trezor Safe 5 | `T3T1` | `features.internal_model === 'T3T1'` |
| Trezor Safe 7 | `T3W1` | `features.internal_model === 'T3W1'` |

### Initialization

```typescript
await TrezorConnect.init({
  manifest: {
    email: 'support@sanctuary.bitcoin',
    appUrl: window.location.origin,
    appName: 'Sanctuary',
  },
  coreMode: 'auto',   // Use bridge or WebUSB as available
  lazyLoad: false,    // Initialize immediately
});
```

### Connection Flow

1. **Initialize** Trezor Connect (once per session)
2. **Get Features** to detect device model and state
3. **Get Public Key** at `m/0'` to obtain master fingerprint
4. Return `HardwareWalletDevice` with device info

### PSBT Signing

Trezor uses its own transaction format, not PSBTs. The adapter:

1. **Parses the PSBT** using bitcoinjs-lib
2. **Fetches reference transactions** from the backend (required for Trezor)
3. **Converts to Trezor format** (inputs, outputs, refTxs)
4. **Calls signTransaction** via Trezor Connect
5. **Returns the signed raw transaction** in `PSBTSignResponse.rawTx`

#### Reference Transactions

Trezor requires the full previous transactions for each input to verify amounts. The adapter fetches these from the backend:

```typescript
const refTxs = await fetchRefTxs(psbt);
// Fetches /api/v1/transactions/{txid}/raw for each input's previous tx
```

#### Script Type Mapping

The adapter maps BIP derivation paths to Trezor script types:

| Path | Trezor Script Type | Bitcoin Address Type |
|------|-------------------|---------------------|
| `m/44'/...` | `SPENDADDRESS` | Legacy (P2PKH) |
| `m/49'/...` | `SPENDP2SHWITNESS` | Nested SegWit (P2SH-P2WPKH) |
| `m/84'/...` | `SPENDWITNESS` | Native SegWit (P2WPKH) |
| `m/86'/...` | `SPENDTAPROOT` | Taproot (P2TR) |

### Important: Raw Transaction Return

Unlike Ledger, **Trezor does not return a signed PSBT**. It returns a fully signed, serialized transaction ready to broadcast:

```typescript
const result = await TrezorConnect.signTransaction({...});
// result.payload.serializedTx is the raw tx hex

return {
  psbt: originalPsbt,  // Original for reference only
  rawTx: result.payload.serializedTx,  // Ready to broadcast
  signatures: inputCount,
};
```

The backend broadcast endpoint accepts both `signedPsbt` and `rawTxHex`, using whichever is provided.

### Error Handling

Common Trezor errors and their user-friendly messages:

| Error Contains | User Message |
|----------------|--------------|
| `Popup closed` | Connection cancelled by user |
| `Device not found` | No Trezor device found. Please connect your device and ensure Trezor Suite is running. |
| `Bridge not running` | Trezor Suite bridge not running. Please open Trezor Suite desktop app. |
| `Cancelled` / `rejected` | Transaction rejected on Trezor. Please approve the transaction on your device. |
| `PIN` | Incorrect PIN. Please try again. |
| `Passphrase` | Passphrase entry cancelled. |
| `Device disconnected` | Trezor disconnected. Please reconnect and try again. |

---

## Ledger Integration

### Overview

The Ledger adapter uses **WebUSB** to communicate directly with Ledger devices in the browser. This requires HTTPS (secure context).

### Supported Devices

- Ledger Nano S / S Plus
- Ledger Nano X
- Ledger Stax
- Ledger Flex

### Key Differences from Trezor

| Feature | Ledger | Trezor |
|---------|--------|--------|
| Connection | WebUSB (direct) | Trezor Connect (bridge) |
| HTTPS Required | Yes (WebUSB) | No (uses popup) |
| Returns | Signed PSBT | Raw Transaction |
| Desktop App | Close Ledger Live | Open Trezor Suite |
| Bitcoin App | Must be open | Not required |

---

## Adding a New Device Adapter

1. Create adapter file in `services/hardwareWallet/adapters/`:

```typescript
// adapters/mydevice.ts
export class MyDeviceAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'mydevice';
  readonly displayName = 'MyDevice';

  isSupported(): boolean {
    // Check browser capabilities
  }

  async connect(): Promise<HardwareWalletDevice> {
    // Connect to device
  }

  async getXpub(path: string): Promise<XpubResult> {
    // Get extended public key
  }

  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    // Sign transaction
  }

  // ... implement other methods
}
```

2. Export from `adapters/index.ts`:

```typescript
export * from './mydevice';
```

3. Register in `index.ts`:

```typescript
import { MyDeviceAdapter } from './adapters/mydevice';
service.registerAdapter(new MyDeviceAdapter());
```

---

## Known Limitations

### Trezor

1. **Requires Trezor Suite** - The Trezor Connect bridge must be running
2. **No signed PSBT** - Returns raw transaction, not PSBT
3. **Reference txs required** - Must fetch previous transactions from backend
4. **Popup-based** - Opens connect.trezor.io popup for operations

### Ledger

1. **HTTPS required** - WebUSB needs secure context
2. **Single connection** - Close Ledger Live before connecting
3. **Bitcoin app required** - Must be open on device

### General

1. **Browser support** - Chrome, Edge, Brave only (WebUSB)
2. **No Firefox/Safari** - These browsers don't support WebUSB
3. **Camera for QR** - HTTPS required for air-gapped device QR scanning

---

## Testing Considerations

### Testnet Support

Both adapters detect testnet from the derivation path:

```typescript
const isTestnet = path.includes("/1'/");
const coin = isTestnet ? 'Testnet' : 'Bitcoin';
```

### Mocking

For unit tests, mock the adapter interface:

```typescript
const mockAdapter: DeviceAdapter = {
  type: 'trezor',
  displayName: 'Mock Trezor',
  isSupported: () => true,
  connect: async () => mockDevice,
  signPSBT: async () => mockSignedResponse,
  // ...
};
```

---

## Security Notes

1. **Keys never leave device** - All signing happens on hardware
2. **Verify on device** - Users must confirm transactions on device screen
3. **HTTPS enforced** - Ledger requires secure context
4. **No seed phrases** - Sanctuary never has access to recovery phrases
5. **Watch-only** - Sanctuary only stores xpubs, not private keys
