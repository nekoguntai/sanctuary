/**
 * Infrastructure Module
 *
 * Centralized infrastructure services for the application.
 * Provides distributed cache, event bus, and other cross-cutting concerns.
 */

export {
  initializeRedis,
  shutdownRedis,
  getDistributedCache,
  getNamespacedCache,
  getDistributedEventBus,
  isRedisConnected,
  getRedisClient,
  checkRedisHealth,
} from './redis';
