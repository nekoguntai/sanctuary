/**
 * Service Context
 *
 * Provides dependency injection for frontend services (API client, WebSocket).
 * Enables testability by allowing mock services to be injected.
 *
 * Usage:
 *   // Production (default services)
 *   <ServiceProvider>
 *     <App />
 *   </ServiceProvider>
 *
 *   // Testing (mock services)
 *   <ServiceProvider apiClient={mockApiClient} websocketClient={mockWsClient}>
 *     <ComponentUnderTest />
 *   </ServiceProvider>
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import defaultApiClient from '../src/api/client';
import { websocketClient as defaultWebSocketClient, WebSocketClient } from '../services/websocket';

// Define minimal interfaces for the services
// This allows mocking without importing the full implementation

export interface ApiClientInterface {
  get<T>(endpoint: string, options?: unknown): Promise<T>;
  post<T>(endpoint: string, data?: unknown, options?: unknown): Promise<T>;
  put<T>(endpoint: string, data?: unknown, options?: unknown): Promise<T>;
  delete<T>(endpoint: string, options?: unknown): Promise<T>;
  getToken(): string | null;
  setToken(token: string): void;
  clearToken(): void;
}

export interface WebSocketClientInterface {
  connect(token?: string): void;
  disconnect(): void;
  subscribe(channel: string): void;
  unsubscribe(channel: string): void;
  on(event: string, callback: (data: unknown) => void): () => void;
  off(event: string, callback: (data: unknown) => void): void;
  onConnectionChange(callback: (connected: boolean) => void): () => void;
  isConnected(): boolean;
}

export interface Services {
  apiClient: ApiClientInterface;
  websocketClient: WebSocketClientInterface;
}

// Create context with null default (requires provider)
const ServiceContext = createContext<Services | null>(null);

export interface ServiceProviderProps {
  children: ReactNode;
  /** Override API client (for testing) */
  apiClient?: ApiClientInterface;
  /** Override WebSocket client (for testing) */
  websocketClient?: WebSocketClientInterface;
}

/**
 * Service Provider Component
 *
 * Wraps the application to provide service instances via context.
 * In production, uses default service instances.
 * In tests, allows injecting mock services.
 */
export function ServiceProvider({
  children,
  apiClient = defaultApiClient as unknown as ApiClientInterface,
  websocketClient = defaultWebSocketClient as unknown as WebSocketClientInterface,
}: ServiceProviderProps) {
  // Memoize the services object to prevent unnecessary re-renders
  const services = useMemo<Services>(
    () => ({
      apiClient,
      websocketClient,
    }),
    [apiClient, websocketClient]
  );

  return (
    <ServiceContext.Provider value={services}>
      {children}
    </ServiceContext.Provider>
  );
}

/**
 * Hook to access all services
 */
export function useServices(): Services {
  const services = useContext(ServiceContext);
  if (!services) {
    throw new Error('useServices must be used within a ServiceProvider');
  }
  return services;
}

/**
 * Hook to access the API client
 */
export function useApiClient(): ApiClientInterface {
  const { apiClient } = useServices();
  return apiClient;
}

/**
 * Hook to access the WebSocket client
 */
export function useWebSocketClient(): WebSocketClientInterface {
  const { websocketClient } = useServices();
  return websocketClient;
}

export default ServiceContext;
