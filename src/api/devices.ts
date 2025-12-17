/**
 * Devices API
 *
 * API calls for hardware device management
 */

import apiClient from './client';
import type { Device, HardwareDeviceModel } from '../types';

// Re-export types for backward compatibility
export type { Device, HardwareDeviceModel } from '../types';

export interface CreateDeviceRequest {
  type: string;
  label: string;
  fingerprint: string;
  derivationPath?: string;
  xpub: string;
  modelSlug?: string;
}

export interface UpdateDeviceRequest {
  label?: string;
  derivationPath?: string;
  type?: string;
  modelSlug?: string;
}

/**
 * Get all devices for current user
 */
export async function getDevices(): Promise<Device[]> {
  return apiClient.get<Device[]>('/devices');
}

/**
 * Get a specific device by ID
 */
export async function getDevice(deviceId: string): Promise<Device> {
  return apiClient.get<Device>(`/devices/${deviceId}`);
}

/**
 * Register a new device
 */
export async function createDevice(data: CreateDeviceRequest): Promise<Device> {
  return apiClient.post<Device>('/devices', data);
}

/**
 * Update a device
 */
export async function updateDevice(deviceId: string, data: UpdateDeviceRequest): Promise<Device> {
  return apiClient.patch<Device>(`/devices/${deviceId}`, data);
}

/**
 * Delete a device
 */
export async function deleteDevice(deviceId: string): Promise<void> {
  return apiClient.delete<void>(`/devices/${deviceId}`);
}

// ========================================
// HARDWARE DEVICE MODELS (Public endpoints)
// ========================================

export interface DeviceModelFilters {
  manufacturer?: string;
  airGapped?: boolean;
  connectivity?: string;
  showDiscontinued?: boolean;
}

/**
 * Get all available hardware device models
 */
export async function getDeviceModels(filters?: DeviceModelFilters): Promise<HardwareDeviceModel[]> {
  const params = new URLSearchParams();
  if (filters?.manufacturer) params.append('manufacturer', filters.manufacturer);
  if (filters?.airGapped !== undefined) params.append('airGapped', String(filters.airGapped));
  if (filters?.connectivity) params.append('connectivity', filters.connectivity);
  if (filters?.showDiscontinued) params.append('showDiscontinued', 'true');

  const queryString = params.toString();
  return apiClient.get<HardwareDeviceModel[]>(`/devices/models${queryString ? `?${queryString}` : ''}`);
}

/**
 * Get a specific device model by slug
 */
export async function getDeviceModel(slug: string): Promise<HardwareDeviceModel> {
  return apiClient.get<HardwareDeviceModel>(`/devices/models/${slug}`);
}

/**
 * Get list of all manufacturers
 */
export async function getManufacturers(): Promise<string[]> {
  return apiClient.get<string[]>('/devices/manufacturers');
}
