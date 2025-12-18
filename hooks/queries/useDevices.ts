import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as devicesApi from '../../src/api/devices';

// Query key factory for device-related queries
export const deviceKeys = {
  all: ['devices'] as const,
  lists: () => [...deviceKeys.all, 'list'] as const,
  detail: (id: string) => [...deviceKeys.all, 'detail', id] as const,
};

/**
 * Hook to fetch all devices for the current user
 */
export function useDevices() {
  return useQuery({
    queryKey: deviceKeys.lists(),
    queryFn: devicesApi.getDevices,
  });
}

/**
 * Hook to fetch a single device by ID
 */
export function useDevice(id: string | undefined) {
  return useQuery({
    queryKey: deviceKeys.detail(id!),
    queryFn: () => devicesApi.getDevice(id!),
    enabled: !!id,
  });
}

/**
 * Hook to create a new device
 */
export function useCreateDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: devicesApi.createDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() });
    },
  });
}

/**
 * Hook to delete a device
 */
export function useDeleteDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (deviceId: string) => devicesApi.deleteDevice(deviceId),
    onSuccess: (_data, deviceId) => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() });
      queryClient.removeQueries({ queryKey: deviceKeys.detail(deviceId) });
    },
  });
}

/**
 * Helper to invalidate all device data
 */
export function useInvalidateDevices() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: deviceKeys.all });
  };
}
