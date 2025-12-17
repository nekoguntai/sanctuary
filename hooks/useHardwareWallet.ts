import { useState, useEffect, useCallback } from 'react';
import {
  HardwareWalletDevice,
  DeviceType,
  TransactionForSigning,
  PSBTSignRequest,
  hardwareWalletService,
  isHardwareWalletSupported,
  getConnectedDevices,
} from '../services/hardwareWallet';
import { createLogger } from '../utils/logger';

const log = createLogger('useHardwareWallet');

export interface UseHardwareWalletReturn {
  // Device state
  device: HardwareWalletDevice | null;
  devices: HardwareWalletDevice[];
  isConnected: boolean;
  isSupported: boolean;

  // Loading states
  connecting: boolean;
  signing: boolean;

  // Error state
  error: string | null;

  // Actions
  connect: (type?: DeviceType) => Promise<void>;
  disconnect: () => void;
  signTransaction: (tx: TransactionForSigning) => Promise<string>;
  signPSBT: (psbtBase64: string, inputPaths?: string[]) => Promise<{ psbt: string; rawTx?: string }>;
  refreshDevices: () => Promise<void>;
  clearError: () => void;
}

/**
 * React hook for hardware wallet integration
 *
 * Provides state management and actions for hardware wallet operations
 */
export const useHardwareWallet = (): UseHardwareWalletReturn => {
  const [device, setDevice] = useState<HardwareWalletDevice | null>(null);
  const [devices, setDevices] = useState<HardwareWalletDevice[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(() => isHardwareWalletSupported());

  /**
   * Refresh list of connected devices
   */
  const refreshDevices = useCallback(async () => {
    try {
      const connectedDevices = await getConnectedDevices();
      setDevices(connectedDevices);
    } catch (err) {
      log.error('Failed to refresh devices', { error: err });
    }
  }, []);

  /**
   * Initial device discovery
   */
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  /**
   * Connect to a hardware wallet
   */
  const connect = useCallback(async (type?: DeviceType) => {
    try {
      setConnecting(true);
      setError(null);

      const connectedDevice = await hardwareWalletService.connect(type);
      setDevice(connectedDevice);

      // Refresh device list
      await refreshDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to device';
      setError(message);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [refreshDevices]);

  /**
   * Disconnect from current device
   */
  const disconnect = useCallback(() => {
    hardwareWalletService.disconnect();
    setDevice(null);
    setError(null);
  }, []);

  /**
   * Sign a transaction with the connected device
   */
  const signTransaction = useCallback(async (tx: TransactionForSigning): Promise<string> => {
    try {
      setSigning(true);
      setError(null);

      if (!device) {
        throw new Error('No device connected');
      }

      const txid = await hardwareWalletService.signTransaction(tx);
      return txid;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign transaction';
      setError(message);
      throw err;
    } finally {
      setSigning(false);
    }
  }, [device]);

  /**
   * Sign a PSBT with hardware wallet
   * Returns both the signed PSBT and optionally a raw transaction hex (for Trezor)
   */
  const signPSBT = useCallback(async (psbtBase64: string, inputPaths: string[] = []): Promise<{ psbt: string; rawTx?: string }> => {
    if (!device) {
      throw new Error('No device connected');
    }

    try {
      setSigning(true);
      setError(null);

      const result = await hardwareWalletService.signPSBT({
        psbt: psbtBase64,
        inputPaths,
      });

      // Return both psbt and rawTx (rawTx is only set for Trezor)
      return { psbt: result.psbt, rawTx: result.rawTx };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign PSBT';
      setError(message);
      throw err;
    } finally {
      setSigning(false);
    }
  }, [device]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    device,
    devices,
    isConnected: device !== null && device.connected,
    isSupported,
    connecting,
    signing,
    error,
    connect,
    disconnect,
    signTransaction,
    signPSBT,
    refreshDevices,
    clearError,
  };
};
