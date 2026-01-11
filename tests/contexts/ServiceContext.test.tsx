/**
 * ServiceContext Tests
 *
 * Tests for the service dependency injection context.
 * Covers provider functionality, hooks, and mock injection.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React, { ReactNode } from 'react';
import {
  ServiceProvider,
  useServices,
  useApiClient,
  useWebSocketClient,
  ApiClientInterface,
  WebSocketClientInterface,
} from '../../contexts/ServiceContext';

// Mock API client
const createMockApiClient = (): ApiClientInterface => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  getToken: vi.fn(() => 'test-token'),
  setToken: vi.fn(),
  clearToken: vi.fn(),
});

// Mock WebSocket client
const createMockWebSocketClient = (): WebSocketClientInterface => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  on: vi.fn(() => vi.fn()),
  off: vi.fn(),
  onConnectionChange: vi.fn(() => vi.fn()),
  isConnected: vi.fn(() => false),
});

describe('ServiceContext', () => {
  describe('ServiceProvider', () => {
    it('should provide services to children', () => {
      const mockApi = createMockApiClient();
      const mockWs = createMockWebSocketClient();

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ServiceProvider apiClient={mockApi} websocketClient={mockWs}>
          {children}
        </ServiceProvider>
      );

      const { result } = renderHook(() => useServices(), { wrapper });

      expect(result.current.apiClient).toBe(mockApi);
      expect(result.current.websocketClient).toBe(mockWs);
    });

    it('should memoize services object', () => {
      const mockApi = createMockApiClient();
      const mockWs = createMockWebSocketClient();

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ServiceProvider apiClient={mockApi} websocketClient={mockWs}>
          {children}
        </ServiceProvider>
      );

      const { result, rerender } = renderHook(() => useServices(), { wrapper });
      const firstServices = result.current;

      rerender();

      expect(result.current).toBe(firstServices);
    });
  });

  describe('useServices', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useServices());
      }).toThrow('useServices must be used within a ServiceProvider');
    });

    it('should return both api and websocket clients', () => {
      const mockApi = createMockApiClient();
      const mockWs = createMockWebSocketClient();

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ServiceProvider apiClient={mockApi} websocketClient={mockWs}>
          {children}
        </ServiceProvider>
      );

      const { result } = renderHook(() => useServices(), { wrapper });

      expect(result.current).toHaveProperty('apiClient');
      expect(result.current).toHaveProperty('websocketClient');
    });
  });

  describe('useApiClient', () => {
    it('should return the api client', () => {
      const mockApi = createMockApiClient();
      const mockWs = createMockWebSocketClient();

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ServiceProvider apiClient={mockApi} websocketClient={mockWs}>
          {children}
        </ServiceProvider>
      );

      const { result } = renderHook(() => useApiClient(), { wrapper });

      expect(result.current).toBe(mockApi);
    });

    it('should allow calling api client methods', async () => {
      const mockApi = createMockApiClient();
      const mockWs = createMockWebSocketClient();
      (mockApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'test' });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ServiceProvider apiClient={mockApi} websocketClient={mockWs}>
          {children}
        </ServiceProvider>
      );

      const { result } = renderHook(() => useApiClient(), { wrapper });

      await result.current.get('/test');
      expect(mockApi.get).toHaveBeenCalledWith('/test');
    });
  });

  describe('useWebSocketClient', () => {
    it('should return the websocket client', () => {
      const mockApi = createMockApiClient();
      const mockWs = createMockWebSocketClient();

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ServiceProvider apiClient={mockApi} websocketClient={mockWs}>
          {children}
        </ServiceProvider>
      );

      const { result } = renderHook(() => useWebSocketClient(), { wrapper });

      expect(result.current).toBe(mockWs);
    });

    it('should allow calling websocket client methods', () => {
      const mockApi = createMockApiClient();
      const mockWs = createMockWebSocketClient();

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ServiceProvider apiClient={mockApi} websocketClient={mockWs}>
          {children}
        </ServiceProvider>
      );

      const { result } = renderHook(() => useWebSocketClient(), { wrapper });

      result.current.connect('token');
      expect(mockWs.connect).toHaveBeenCalledWith('token');

      result.current.subscribe('channel');
      expect(mockWs.subscribe).toHaveBeenCalledWith('channel');
    });
  });
});
