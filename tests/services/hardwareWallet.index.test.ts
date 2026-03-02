/**
 * hardwareWallet index tests
 *
 * Mocks concrete adapter implementations so index wiring can be tested
 * without hardware/browser-specific adapter internals.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeMockAdapterClass(type: string, displayName: string) {
  return class {
    readonly type = type;
    readonly displayName = displayName;
    isSupported() { return true; }
    isConnected() { return false; }
    getDevice() { return null; }
    async connect() {
      return {
        id: `${type}-1`,
        type,
        name: `${displayName} Device`,
        connected: true,
      };
    }
    async disconnect() { return undefined; }
    async getXpub(path: string) {
      return { xpub: `${type}-xpub`, fingerprint: 'f1f1f1f1', path };
    }
    async signPSBT() {
      return { psbt: `${type}-signed`, signatures: 1 };
    }
    async getAuthorizedDevices() {
      return [{
        id: `${type}-1`,
        type,
        name: `${displayName} Device`,
        connected: true,
      }];
    }
  };
}

vi.mock('../../services/hardwareWallet/adapters/ledger', () => ({
  LedgerAdapter: makeMockAdapterClass('ledger', 'Ledger'),
}));
vi.mock('../../services/hardwareWallet/adapters/trezor', () => ({
  TrezorAdapter: makeMockAdapterClass('trezor', 'Trezor'),
}));
vi.mock('../../services/hardwareWallet/adapters/bitbox', () => ({
  BitBoxAdapter: makeMockAdapterClass('bitbox', 'BitBox'),
}));
vi.mock('../../services/hardwareWallet/adapters/jade', () => ({
  JadeAdapter: makeMockAdapterClass('jade', 'Jade'),
}));

import {
  getConnectedDevices,
  hardwareWalletService,
  isHardwareWalletSupported,
  isSecureContext,
  isWebUSBSupported,
} from '../../services/hardwareWallet';

const originalNavigator = globalThis.navigator;
const originalWindow = globalThis.window;

describe('hardwareWallet index', () => {
  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    }
  });

  it('registers built-in adapters on singleton service', () => {
    const adapters = hardwareWalletService.getRegisteredAdapters();
    const types = adapters.map(a => a.type).sort();
    expect(types).toEqual(['bitbox', 'jade', 'ledger', 'trezor']);
  });

  it('reports WebUSB and secure-context support combinations', () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: { isSecureContext: false }, configurable: true });
    expect(isWebUSBSupported()).toBe(false);
    expect(isSecureContext()).toBe(false);
    expect(isHardwareWalletSupported()).toBe(false);

    Object.defineProperty(globalThis, 'navigator', { value: { usb: {} }, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: { isSecureContext: true }, configurable: true });
    expect(isWebUSBSupported()).toBe(true);
    expect(isSecureContext()).toBe(true);
    expect(isHardwareWalletSupported()).toBe(true);
  });

  it('returns connected devices via singleton service proxy', async () => {
    const devices = await getConnectedDevices();
    const types = devices.map(d => d.type).sort();
    expect(types).toEqual(['bitbox', 'jade', 'ledger', 'trezor']);
  });
});

