/**
 * Generic Provider Types
 *
 * Defines base interfaces for pluggable provider architectures.
 * Providers can be registered, health-checked, and invoked dynamically.
 *
 * @module providers/types
 */

/**
 * Base provider interface that all providers must implement
 */
export interface IProvider {
  /**
   * Unique provider name/identifier
   */
  readonly name: string;

  /**
   * Provider priority (higher = preferred)
   * Used for failover ordering
   */
  readonly priority: number;

  /**
   * Check if the provider is currently healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Provider with lifecycle hooks
 */
export interface IProviderLifecycle extends IProvider {
  /**
   * Called when provider is registered
   */
  onRegister?(): Promise<void>;

  /**
   * Called when provider is unregistered
   */
  onUnregister?(): Promise<void>;

  /**
   * Called when health status changes
   */
  onHealthChange?(healthy: boolean): void;
}

/**
 * Provider health status
 */
export interface ProviderHealthStatus {
  name: string;
  healthy: boolean;
  lastCheck: Date;
  latencyMs?: number;
  error?: string;
}

/**
 * Registry health summary
 */
export interface RegistryHealthSummary {
  totalProviders: number;
  healthyProviders: number;
  unhealthyProviders: number;
  providers: ProviderHealthStatus[];
}

/**
 * Generic provider registry interface
 */
export interface IProviderRegistry<T extends IProvider> {
  /**
   * Register a provider
   */
  register(provider: T): Promise<void>;

  /**
   * Unregister a provider by name
   */
  unregister(name: string): Promise<void>;

  /**
   * Get a provider by name
   */
  get(name: string): T | undefined;

  /**
   * Get all registered providers
   */
  getAll(): T[];

  /**
   * Get all healthy providers (sorted by priority)
   */
  getHealthy(): Promise<T[]>;

  /**
   * Get the best (highest priority) healthy provider
   */
  getBest(): Promise<T | undefined>;

  /**
   * Invoke a method on the best available provider
   * Falls back to next provider on failure
   */
  invoke<R>(
    method: (provider: T) => Promise<R>,
    options?: InvokeOptions
  ): Promise<R>;

  /**
   * Invoke a method on all healthy providers
   */
  invokeAll<R>(
    method: (provider: T) => Promise<R>,
    options?: InvokeOptions
  ): Promise<R[]>;

  /**
   * Get health status of all providers
   */
  getHealth(): Promise<RegistryHealthSummary>;

  /**
   * Check if any healthy providers are available
   */
  hasHealthy(): Promise<boolean>;
}

/**
 * Options for provider invocation
 */
export interface InvokeOptions {
  /**
   * Specific provider to use (bypasses priority selection)
   */
  provider?: string;

  /**
   * Timeout in milliseconds
   */
  timeoutMs?: number;

  /**
   * Maximum retries on failure
   */
  maxRetries?: number;

  /**
   * Whether to throw on complete failure
   * @default true
   */
  throwOnFailure?: boolean;
}

/**
 * Provider factory function type
 */
export type ProviderFactory<T extends IProvider, C = unknown> = (config: C) => Promise<T>;

/**
 * Provider configuration for factory registry
 */
export interface ProviderFactoryConfig<C = unknown> {
  type: string;
  config: C;
}
