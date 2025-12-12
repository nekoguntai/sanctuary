// Device abstraction layer - common interface for all hardware wallets

import type { DeviceType, HWDevice, XpubResult, SignPSBTResult } from '../types/messages';

export interface DeviceDriver {
  readonly type: DeviceType;

  // Check if this device type is supported in current environment
  isSupported(): boolean;

  // Enumerate connected devices of this type
  enumerate(): Promise<HWDevice[]>;

  // Connect to a specific device (may prompt user)
  connect(): Promise<HWDevice>;

  // Disconnect from device
  disconnect(deviceId: string): Promise<void>;

  // Get extended public key at derivation path
  getXpub(deviceId: string, path: string): Promise<XpubResult>;

  // Sign a PSBT
  signPSBT(deviceId: string, psbt: string, inputPaths: string[]): Promise<SignPSBTResult>;

  // Display address on device for verification
  verifyAddress(deviceId: string, path: string, address: string): Promise<boolean>;
}

// Registry of device drivers
const drivers: Map<DeviceType, DeviceDriver> = new Map();

export function registerDriver(driver: DeviceDriver): void {
  drivers.set(driver.type, driver);
}

export function getDriver(type: DeviceType): DeviceDriver | undefined {
  return drivers.get(type);
}

export function getAllDrivers(): DeviceDriver[] {
  return Array.from(drivers.values());
}

export function getSupportedDrivers(): DeviceDriver[] {
  return getAllDrivers().filter(d => d.isSupported());
}

// Device manager - coordinates across all drivers
export class DeviceManager {
  private connectedDevices: Map<string, HWDevice> = new Map();
  private deviceTypeMap: Map<string, DeviceType> = new Map();
  private listeners: Set<(devices: HWDevice[]) => void> = new Set();

  async enumerateAll(): Promise<HWDevice[]> {
    const devices: HWDevice[] = [];

    for (const driver of getSupportedDrivers()) {
      try {
        const driverDevices = await driver.enumerate();
        for (const device of driverDevices) {
          this.connectedDevices.set(device.id, device);
          this.deviceTypeMap.set(device.id, driver.type);
          devices.push(device);
        }
      } catch (error) {
        console.warn(`Failed to enumerate ${driver.type} devices:`, error);
      }
    }

    return devices;
  }

  async connectDevice(type: DeviceType): Promise<HWDevice> {
    const driver = getDriver(type);
    if (!driver) {
      throw new Error(`No driver for device type: ${type}`);
    }
    if (!driver.isSupported()) {
      throw new Error(`Device type ${type} is not supported in this environment`);
    }

    const device = await driver.connect();
    this.connectedDevices.set(device.id, device);
    this.deviceTypeMap.set(device.id, type);
    this.notifyListeners();

    return device;
  }

  async disconnectDevice(deviceId: string): Promise<void> {
    const type = this.deviceTypeMap.get(deviceId);
    if (!type) {
      throw new Error(`Unknown device: ${deviceId}`);
    }

    const driver = getDriver(type);
    if (driver) {
      await driver.disconnect(deviceId);
    }

    this.connectedDevices.delete(deviceId);
    this.deviceTypeMap.delete(deviceId);
    this.notifyListeners();
  }

  async getXpub(deviceId: string, path: string): Promise<XpubResult> {
    const type = this.deviceTypeMap.get(deviceId);
    if (!type) {
      // Try to find the device first
      const devices = await this.enumerateAll();
      const device = devices.find(d => d.id === deviceId);
      if (!device) {
        throw new Error(`Device not found: ${deviceId}`);
      }
    }

    const deviceType = this.deviceTypeMap.get(deviceId);
    const driver = getDriver(deviceType!);
    if (!driver) {
      throw new Error(`No driver for device: ${deviceId}`);
    }

    return driver.getXpub(deviceId, path);
  }

  async signPSBT(deviceId: string, psbt: string, inputPaths: string[]): Promise<SignPSBTResult> {
    const type = this.deviceTypeMap.get(deviceId);
    if (!type) {
      throw new Error(`Unknown device: ${deviceId}`);
    }

    const driver = getDriver(type);
    if (!driver) {
      throw new Error(`No driver for device type: ${type}`);
    }

    return driver.signPSBT(deviceId, psbt, inputPaths);
  }

  async verifyAddress(deviceId: string, path: string, address: string): Promise<boolean> {
    const type = this.deviceTypeMap.get(deviceId);
    if (!type) {
      throw new Error(`Unknown device: ${deviceId}`);
    }

    const driver = getDriver(type);
    if (!driver) {
      throw new Error(`No driver for device type: ${type}`);
    }

    return driver.verifyAddress(deviceId, path, address);
  }

  getConnectedDevices(): HWDevice[] {
    return Array.from(this.connectedDevices.values());
  }

  getDevice(deviceId: string): HWDevice | undefined {
    return this.connectedDevices.get(deviceId);
  }

  onDeviceChange(callback: (devices: HWDevice[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const devices = this.getConnectedDevices();
    for (const listener of this.listeners) {
      try {
        listener(devices);
      } catch (error) {
        console.error('Device change listener error:', error);
      }
    }
  }
}

// Singleton instance
export const deviceManager = new DeviceManager();
