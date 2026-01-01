/**
 * Provider Architecture Module
 *
 * Generic provider infrastructure for pluggable service implementations.
 * Supports health checking, priority-based selection, and automatic failover.
 *
 * @module providers
 */

export { ProviderRegistry, createProviderRegistry } from './registry';
export type { RegistryOptions } from './registry';

export type {
  IProvider,
  IProviderLifecycle,
  IProviderRegistry,
  InvokeOptions,
  ProviderHealthStatus,
  RegistryHealthSummary,
  ProviderFactory,
  ProviderFactoryConfig,
} from './types';
