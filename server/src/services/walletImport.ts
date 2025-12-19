/**
 * Wallet Import Service
 *
 * Handles importing wallets from descriptors or JSON configurations.
 * Automatically resolves device conflicts by reusing existing devices
 * when fingerprints match, or creating new devices otherwise.
 */

import prisma from '../models/prisma';
import type {
  ParsedDescriptor,
  ParsedDevice,
  JsonImportDevice,
  JsonImportConfig,
  ScriptType,
  Network,
} from './bitcoin/descriptorParser';
import {
  parseDescriptorForImport,
  parseJsonImport,
  parseImportInput,
  validateDescriptor,
  validateJsonImport,
} from './bitcoin/descriptorParser';
import * as descriptorBuilder from './bitcoin/descriptorBuilder';
import * as addressDerivation from './bitcoin/addressDerivation';
import { createLogger } from '../utils/logger';
import { INITIAL_ADDRESS_COUNT } from '../constants';

const log = createLogger('IMPORT');

export interface DeviceResolution {
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  existingDeviceId: string | null;
  existingDeviceLabel: string | null;
  willCreate: boolean;
  suggestedLabel?: string;
  originalType?: string;
}

export interface ImportValidationResult {
  valid: boolean;
  error?: string;
  format: 'descriptor' | 'json' | 'wallet_export' | 'bluewallet_text' | 'coldcard';
  walletType: 'single_sig' | 'multi_sig';
  scriptType: ScriptType;
  network: Network;
  quorum?: number;
  totalSigners?: number;
  devices: DeviceResolution[];
  suggestedName?: string;
}

export interface ImportWalletResult {
  wallet: {
    id: string;
    name: string;
    type: string;
    scriptType: string;
    network: string;
    quorum?: number | null;
    totalSigners?: number | null;
    descriptor?: string | null;
  };
  devicesCreated: number;
  devicesReused: number;
  createdDeviceIds: string[];
  reusedDeviceIds: string[];
}

/**
 * Generate a unique device label that doesn't conflict with existing labels
 */
function generateUniqueLabel(
  baseLabel: string,
  existingLabels: Set<string>
): string {
  // If the base label is unique, use it
  if (!existingLabels.has(baseLabel.toLowerCase())) {
    return baseLabel;
  }

  // Otherwise, append a number to make it unique
  let counter = 2;
  let newLabel = `${baseLabel} (${counter})`;
  while (existingLabels.has(newLabel.toLowerCase())) {
    counter++;
    newLabel = `${baseLabel} (${counter})`;
  }
  return newLabel;
}

/**
 * Resolve devices from parsed import data against existing user devices
 */
async function resolveDevices(
  userId: string,
  parsedDevices: ParsedDevice[],
  originalDevices?: JsonImportDevice[]
): Promise<DeviceResolution[]> {
  // Fetch all user's existing devices
  const existingDevices = await prisma.device.findMany({
    where: { userId },
    select: {
      id: true,
      fingerprint: true,
      label: true,
      xpub: true,
    },
  });

  // Create maps for quick lookup
  const deviceByFingerprint = new Map(
    existingDevices.map((d) => [d.fingerprint.toLowerCase(), d])
  );

  // Track all existing labels (case-insensitive)
  const existingLabels = new Set(
    existingDevices.map((d) => d.label.toLowerCase())
  );

  // Track labels we're assigning in this batch to avoid duplicates within the import
  const assignedLabels = new Set<string>();

  // Resolve each device
  return parsedDevices.map((device, index) => {
    const existing = deviceByFingerprint.get(device.fingerprint.toLowerCase());
    const originalDevice = originalDevices?.[index];

    const resolution: DeviceResolution = {
      fingerprint: device.fingerprint,
      xpub: device.xpub,
      derivationPath: device.derivationPath,
      existingDeviceId: existing?.id || null,
      existingDeviceLabel: existing?.label || null,
      willCreate: !existing,
    };

    if (!existing) {
      // Generate unique suggested label for new device
      const baseLabel = originalDevice?.label || `Imported Device ${index + 1}`;

      // Combine existing labels and already assigned labels for uniqueness check
      const allUsedLabels = new Set([...existingLabels, ...assignedLabels]);
      const uniqueLabel = generateUniqueLabel(baseLabel, allUsedLabels);

      resolution.suggestedLabel = uniqueLabel;
      resolution.originalType = originalDevice?.type || 'unknown';

      // Track this label as assigned
      assignedLabels.add(uniqueLabel.toLowerCase());
    }

    return resolution;
  });
}

/**
 * Validate import data and preview what will happen
 * (without actually creating anything)
 */
export async function validateImport(
  userId: string,
  input: { descriptor?: string; json?: string }
): Promise<ImportValidationResult> {
  const rawInput = input.descriptor || input.json;

  if (!rawInput) {
    return {
      valid: false,
      error: 'Either descriptor or json must be provided',
      format: 'descriptor',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      network: 'mainnet',
      devices: [],
    };
  }

  try {
    // Use unified parser that handles all formats
    const parseResult = parseImportInput(rawInput);

    // Resolve devices
    const devices = await resolveDevices(
      userId,
      parseResult.parsed.devices,
      parseResult.originalDevices
    );

    return {
      valid: true,
      format: parseResult.format,
      walletType: parseResult.parsed.type,
      scriptType: parseResult.parsed.scriptType,
      network: parseResult.parsed.network,
      quorum: parseResult.parsed.quorum,
      totalSigners: parseResult.parsed.totalSigners,
      devices,
      suggestedName: parseResult.suggestedName,
    };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : String(e),
      format: input.json ? 'json' : 'descriptor',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      network: 'mainnet',
      devices: [],
    };
  }
}

/**
 * Import wallet from descriptor string
 */
export async function importFromDescriptor(
  userId: string,
  input: {
    descriptor: string;
    name: string;
    network?: Network;
    deviceLabels?: Record<string, string>; // fingerprint -> label
  }
): Promise<ImportWalletResult> {
  // Parse descriptor (use parseImportInput to handle text with comments)
  const parseResult = parseImportInput(input.descriptor);
  const parsed = parseResult.parsed;
  const network = input.network || parsed.network;

  // Check for duplicate wallet - get all user's wallets and compare device fingerprints
  const newFingerprints = new Set(parsed.devices.map(d => d.fingerprint.toLowerCase()));

  const userWallets = await prisma.wallet.findMany({
    where: {
      users: { some: { userId } },
      descriptor: { not: null },
    },
    select: {
      id: true,
      name: true,
      descriptor: true,
    },
  });

  for (const wallet of userWallets) {
    if (!wallet.descriptor) continue;

    // Extract fingerprints from existing wallet descriptor
    const existingFingerprints = new Set(
      (wallet.descriptor.match(/\[([a-f0-9]{8})\//gi) || [])
        .map(m => m.slice(1, 9).toLowerCase())
    );

    // Check if same set of devices
    if (existingFingerprints.size === newFingerprints.size &&
        [...newFingerprints].every(fp => existingFingerprints.has(fp))) {
      throw new Error(`A wallet with these devices already exists: "${wallet.name}"`);
    }
  }

  // Resolve devices
  const resolutions = await resolveDevices(userId, parsed.devices);

  // Create devices and wallet in a transaction
  return await prisma.$transaction(async (tx) => {
    const createdDeviceIds: string[] = [];
    const reusedDeviceIds: string[] = [];
    const deviceIdsForWallet: string[] = [];

    // Create or reuse devices
    for (const resolution of resolutions) {
      if (resolution.willCreate) {
        // Create new device
        const label =
          input.deviceLabels?.[resolution.fingerprint] ||
          resolution.suggestedLabel ||
          `Imported Device`;

        const newDevice = await tx.device.create({
          data: {
            userId,
            type: resolution.originalType || 'unknown',
            label,
            fingerprint: resolution.fingerprint,
            derivationPath: resolution.derivationPath,
            xpub: resolution.xpub,
          },
        });

        createdDeviceIds.push(newDevice.id);
        deviceIdsForWallet.push(newDevice.id);
      } else {
        reusedDeviceIds.push(resolution.existingDeviceId!);
        deviceIdsForWallet.push(resolution.existingDeviceId!);
      }
    }

    // Build descriptor with proper formatting
    const devices = await tx.device.findMany({
      where: { id: { in: deviceIdsForWallet } },
    });

    // Sort devices by their order in the original parsed.devices
    const sortedDevices = deviceIdsForWallet.map(
      (id) => devices.find((d) => d.id === id)!
    );

    const deviceInfos = sortedDevices.map((d) => ({
      fingerprint: d.fingerprint,
      xpub: d.xpub,
      derivationPath: d.derivationPath || undefined,
    }));

    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
      }
    );

    // Create wallet
    const wallet = await tx.wallet.create({
      data: {
        name: input.name,
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
        totalSigners: parsed.totalSigners,
        descriptor: descriptorResult.descriptor,
        fingerprint: descriptorResult.fingerprint,
        users: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
    });

    // Link devices to wallet
    await tx.walletDevice.createMany({
      data: deviceIdsForWallet.map((deviceId, index) => ({
        walletId: wallet.id,
        deviceId,
        signerIndex: index,
      })),
    });

    // Generate initial addresses (both receive and change)
    try {
      const addressesToCreate = [];

      // Generate receive addresses (change = false)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: false }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Generate change addresses (change = true)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: true }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      await tx.address.createMany({
        data: addressesToCreate,
      });
    } catch (err) {
      log.error('Failed to generate initial addresses', { error: err });
    }

    return {
      wallet: {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        scriptType: wallet.scriptType,
        network: wallet.network,
        quorum: wallet.quorum,
        totalSigners: wallet.totalSigners,
        descriptor: wallet.descriptor,
      },
      devicesCreated: createdDeviceIds.length,
      devicesReused: reusedDeviceIds.length,
      createdDeviceIds,
      reusedDeviceIds,
    };
  });
}

/**
 * Import wallet from JSON configuration
 */
export async function importFromJson(
  userId: string,
  input: {
    json: string;
    name: string;
    network?: Network;
  }
): Promise<ImportWalletResult> {
  // Parse JSON
  const jsonConfig = JSON.parse(input.json) as JsonImportConfig;
  const parsed = parseJsonImport(jsonConfig);
  const network = input.network || parsed.network;

  // Resolve devices with original labels/types from JSON
  const resolutions = await resolveDevices(
    userId,
    parsed.devices,
    jsonConfig.devices
  );

  // Create devices and wallet in a transaction
  return await prisma.$transaction(async (tx) => {
    const createdDeviceIds: string[] = [];
    const reusedDeviceIds: string[] = [];
    const deviceIdsForWallet: string[] = [];

    // Create or reuse devices
    for (let i = 0; i < resolutions.length; i++) {
      const resolution = resolutions[i];
      const originalDevice = jsonConfig.devices[i];

      if (resolution.willCreate) {
        // Create new device with unique label (suggestedLabel is already unique)
        const newDevice = await tx.device.create({
          data: {
            userId,
            type: originalDevice?.type || 'unknown',
            label: resolution.suggestedLabel || `Imported Device ${i + 1}`,
            fingerprint: resolution.fingerprint,
            derivationPath: resolution.derivationPath,
            xpub: resolution.xpub,
          },
        });

        createdDeviceIds.push(newDevice.id);
        deviceIdsForWallet.push(newDevice.id);
      } else {
        reusedDeviceIds.push(resolution.existingDeviceId!);
        deviceIdsForWallet.push(resolution.existingDeviceId!);
      }
    }

    // Build descriptor from devices
    const devices = await tx.device.findMany({
      where: { id: { in: deviceIdsForWallet } },
    });

    const sortedDevices = deviceIdsForWallet.map(
      (id) => devices.find((d) => d.id === id)!
    );

    const deviceInfos = sortedDevices.map((d) => ({
      fingerprint: d.fingerprint,
      xpub: d.xpub,
      derivationPath: d.derivationPath || undefined,
    }));

    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
      }
    );

    // Create wallet
    const wallet = await tx.wallet.create({
      data: {
        name: input.name,
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
        totalSigners: parsed.totalSigners,
        descriptor: descriptorResult.descriptor,
        fingerprint: descriptorResult.fingerprint,
        users: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
    });

    // Link devices to wallet
    await tx.walletDevice.createMany({
      data: deviceIdsForWallet.map((deviceId, index) => ({
        walletId: wallet.id,
        deviceId,
        signerIndex: index,
      })),
    });

    // Generate initial addresses (both receive and change)
    try {
      const addressesToCreate = [];

      // Generate receive addresses (change = false)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: false }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Generate change addresses (change = true)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: true }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      await tx.address.createMany({
        data: addressesToCreate,
      });
    } catch (err) {
      log.error('Failed to generate initial addresses', { error: err });
    }

    return {
      wallet: {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        scriptType: wallet.scriptType,
        network: wallet.network,
        quorum: wallet.quorum,
        totalSigners: wallet.totalSigners,
        descriptor: wallet.descriptor,
      },
      devicesCreated: createdDeviceIds.length,
      devicesReused: reusedDeviceIds.length,
      createdDeviceIds,
      reusedDeviceIds,
    };
  });
}

/**
 * Import wallet from pre-parsed data (e.g., BlueWallet text format)
 */
export async function importFromParsedData(
  userId: string,
  input: {
    parsed: ParsedDescriptor;
    name: string;
    network?: Network;
    deviceLabels?: Record<string, string>; // fingerprint -> label
  }
): Promise<ImportWalletResult> {
  const { parsed } = input;
  const network = input.network || parsed.network;

  // Check for duplicate wallet - get all user's wallets and compare device fingerprints
  const newFingerprints = new Set(parsed.devices.map(d => d.fingerprint.toLowerCase()));

  const userWallets = await prisma.wallet.findMany({
    where: {
      users: { some: { userId } },
      descriptor: { not: null },
    },
    select: {
      id: true,
      name: true,
      descriptor: true,
    },
  });

  for (const wallet of userWallets) {
    if (!wallet.descriptor) continue;

    // Extract fingerprints from existing wallet descriptor
    const existingFingerprints = new Set(
      (wallet.descriptor.match(/\[([a-f0-9]{8})\//gi) || [])
        .map(m => m.slice(1, 9).toLowerCase())
    );

    // Check if same set of devices
    if (existingFingerprints.size === newFingerprints.size &&
        [...newFingerprints].every(fp => existingFingerprints.has(fp))) {
      throw new Error(`A wallet with these devices already exists: "${wallet.name}"`);
    }
  }

  // Resolve devices
  const resolutions = await resolveDevices(userId, parsed.devices);

  // Create devices and wallet in a transaction
  return await prisma.$transaction(async (tx) => {
    const createdDeviceIds: string[] = [];
    const reusedDeviceIds: string[] = [];
    const deviceIdsForWallet: string[] = [];

    // Create or reuse devices
    for (const resolution of resolutions) {
      if (resolution.willCreate) {
        // Create new device
        const label =
          input.deviceLabels?.[resolution.fingerprint] ||
          resolution.suggestedLabel ||
          `Imported Device`;

        const newDevice = await tx.device.create({
          data: {
            userId,
            type: resolution.originalType || 'unknown',
            label,
            fingerprint: resolution.fingerprint,
            derivationPath: resolution.derivationPath,
            xpub: resolution.xpub,
          },
        });

        createdDeviceIds.push(newDevice.id);
        deviceIdsForWallet.push(newDevice.id);
      } else {
        reusedDeviceIds.push(resolution.existingDeviceId!);
        deviceIdsForWallet.push(resolution.existingDeviceId!);
      }
    }

    // Build descriptor with proper formatting
    const devices = await tx.device.findMany({
      where: { id: { in: deviceIdsForWallet } },
    });

    // Sort devices by their order in the original parsed.devices
    const sortedDevices = deviceIdsForWallet.map(
      (id) => devices.find((d) => d.id === id)!
    );

    const deviceInfos = sortedDevices.map((d) => ({
      fingerprint: d.fingerprint,
      xpub: d.xpub,
      derivationPath: d.derivationPath || undefined,
    }));

    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
      }
    );

    // Create wallet
    const wallet = await tx.wallet.create({
      data: {
        name: input.name,
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
        totalSigners: parsed.totalSigners,
        descriptor: descriptorResult.descriptor,
        fingerprint: descriptorResult.fingerprint,
        users: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
    });

    // Link devices to wallet
    await tx.walletDevice.createMany({
      data: deviceIdsForWallet.map((deviceId, index) => ({
        walletId: wallet.id,
        deviceId,
        signerIndex: index,
      })),
    });

    // Generate initial addresses (both receive and change)
    try {
      const addressesToCreate = [];

      // Generate receive addresses (change = false)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: false }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Generate change addresses (change = true)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: true }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      await tx.address.createMany({
        data: addressesToCreate,
      });
    } catch (err) {
      log.error('Failed to generate initial addresses', { error: err });
    }

    return {
      wallet: {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        scriptType: wallet.scriptType,
        network: wallet.network,
        quorum: wallet.quorum,
        totalSigners: wallet.totalSigners,
        descriptor: wallet.descriptor,
      },
      devicesCreated: createdDeviceIds.length,
      devicesReused: reusedDeviceIds.length,
      createdDeviceIds,
      reusedDeviceIds,
    };
  });
}

/**
 * Auto-detect format and import wallet
 */
export async function importWallet(
  userId: string,
  input: {
    data: string; // Either descriptor or JSON
    name: string;
    network?: Network;
    deviceLabels?: Record<string, string>;
  }
): Promise<ImportWalletResult> {
  const trimmed = input.data.trim();

  // Use unified parser to detect format
  const parseResult = parseImportInput(trimmed);

  // For wallet_export format (JSON with descriptor field), extract and use the descriptor
  if (parseResult.format === 'wallet_export') {
    // Parse the JSON to get the descriptor
    const walletExport = JSON.parse(trimmed);
    return importFromDescriptor(userId, {
      descriptor: walletExport.descriptor,
      name: input.name,
      network: input.network,
      deviceLabels: input.deviceLabels,
    });
  }

  // For our custom JSON config format
  if (parseResult.format === 'json') {
    return importFromJson(userId, {
      json: trimmed,
      name: input.name,
      network: input.network,
    });
  }

  // For BlueWallet text format - import using parsed data
  if (parseResult.format === 'bluewallet_text') {
    return importFromParsedData(userId, {
      parsed: parseResult.parsed,
      name: input.name,
      network: input.network,
      deviceLabels: input.deviceLabels,
    });
  }

  // For Coldcard JSON export - import using parsed data
  if (parseResult.format === 'coldcard') {
    return importFromParsedData(userId, {
      parsed: parseResult.parsed,
      name: input.name,
      network: input.network,
      deviceLabels: input.deviceLabels,
    });
  }

  // For plain descriptor format
  return importFromDescriptor(userId, {
    descriptor: trimmed,
    name: input.name,
    network: input.network,
    deviceLabels: input.deviceLabels,
  });
}
