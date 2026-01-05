/**
 * Memory Pressure Monitor
 *
 * Monitors application memory usage and provides backpressure signals
 * to prevent OOM conditions during perpetual operation.
 *
 * ## Features
 *
 * - Real-time memory pressure detection
 * - Configurable thresholds for warning/critical levels
 * - Metrics integration for observability
 * - Load shedding signals for request handling
 *
 * ## Usage
 *
 * ```typescript
 * import { getMemoryPressure, startMemoryMonitoring } from './infrastructure/memoryMonitor';
 *
 * // At startup
 * startMemoryMonitoring();
 *
 * // In request handling
 * const pressure = getMemoryPressure();
 * if (pressure.shouldShedLoad) {
 *   return res.status(503).json({ error: 'Service temporarily unavailable' });
 * }
 * ```
 */

import v8 from 'v8';
import { createLogger } from '../utils/logger';

const log = createLogger('MemoryMonitor');

// =============================================================================
// Types
// =============================================================================

export type MemoryPressureLevel = 'normal' | 'elevated' | 'critical';

export interface MemoryPressure {
  /** Current pressure level */
  level: MemoryPressureLevel;
  /** Heap usage percentage (0-100) */
  heapUsedPercent: number;
  /** Whether non-critical requests should be rejected */
  shouldShedLoad: boolean;
  /** Current heap used in bytes */
  heapUsedBytes: number;
  /** Total heap available in bytes */
  heapTotalBytes: number;
  /** External memory in bytes */
  externalBytes: number;
  /** RSS (Resident Set Size) in bytes */
  rssBytes: number;
}

export interface MemoryMonitorConfig {
  /** Threshold for elevated warning (default: 75%) */
  elevatedThreshold: number;
  /** Threshold for critical/load-shedding (default: 90%) */
  criticalThreshold: number;
  /** Check interval in milliseconds (default: 10000) */
  checkIntervalMs: number;
  /** Enable automatic GC hints at elevated levels (default: true) */
  enableGcHints: boolean;
}

// =============================================================================
// State
// =============================================================================

const DEFAULT_CONFIG: MemoryMonitorConfig = {
  elevatedThreshold: 75,
  criticalThreshold: 90,
  checkIntervalMs: 10000,
  enableGcHints: true,
};

let config: MemoryMonitorConfig = { ...DEFAULT_CONFIG };
let monitorInterval: NodeJS.Timeout | null = null;
let lastPressure: MemoryPressure | null = null;
let consecutiveCriticalCount = 0;

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Get current memory pressure status
 * Call this before processing non-critical requests
 */
export function getMemoryPressure(): MemoryPressure {
  const heapStats = v8.getHeapStatistics();
  const memUsage = process.memoryUsage();

  const heapUsedPercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;

  let level: MemoryPressureLevel = 'normal';
  let shouldShedLoad = false;

  if (heapUsedPercent >= config.criticalThreshold) {
    level = 'critical';
    shouldShedLoad = true;
  } else if (heapUsedPercent >= config.elevatedThreshold) {
    level = 'elevated';
  }

  const pressure: MemoryPressure = {
    level,
    heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
    shouldShedLoad,
    heapUsedBytes: heapStats.used_heap_size,
    heapTotalBytes: heapStats.heap_size_limit,
    externalBytes: memUsage.external,
    rssBytes: memUsage.rss,
  };

  lastPressure = pressure;
  return pressure;
}

/**
 * Get the last measured pressure (cached, no new measurement)
 */
export function getLastPressure(): MemoryPressure | null {
  return lastPressure;
}

/**
 * Check if a specific endpoint should be allowed under current pressure
 * Critical endpoints (auth, health) are always allowed
 */
export function shouldAllowRequest(path: string): boolean {
  const pressure = getMemoryPressure();

  if (!pressure.shouldShedLoad) {
    return true;
  }

  // Always allow critical endpoints
  const criticalPaths = [
    '/health',
    '/api/health',
    '/api/auth/login',
    '/api/auth/refresh',
    '/api/auth/logout',
    '/metrics',
  ];

  return criticalPaths.some((p) => path.startsWith(p));
}

/**
 * Get detailed memory statistics for health endpoints
 */
export function getMemoryStats(): {
  pressure: MemoryPressure;
  heapStats: v8.HeapInfo;
  processMemory: NodeJS.MemoryUsage;
} {
  return {
    pressure: getMemoryPressure(),
    heapStats: v8.getHeapStatistics(),
    processMemory: process.memoryUsage(),
  };
}

// =============================================================================
// Monitoring
// =============================================================================

/**
 * Start periodic memory monitoring
 * Logs warnings at elevated levels and triggers cleanup at critical
 */
export function startMemoryMonitoring(customConfig?: Partial<MemoryMonitorConfig>): void {
  if (monitorInterval) {
    log.warn('Memory monitoring already started');
    return;
  }

  if (customConfig) {
    config = { ...DEFAULT_CONFIG, ...customConfig };
  }

  log.info('Starting memory monitoring', {
    elevatedThreshold: config.elevatedThreshold,
    criticalThreshold: config.criticalThreshold,
    checkIntervalMs: config.checkIntervalMs,
  });

  monitorInterval = setInterval(() => {
    const pressure = getMemoryPressure();

    if (pressure.level === 'critical') {
      consecutiveCriticalCount++;
      log.error('CRITICAL memory pressure - load shedding active', {
        heapUsedPercent: pressure.heapUsedPercent,
        heapUsedMB: Math.round(pressure.heapUsedBytes / 1024 / 1024),
        heapTotalMB: Math.round(pressure.heapTotalBytes / 1024 / 1024),
        rssMB: Math.round(pressure.rssBytes / 1024 / 1024),
        consecutiveCritical: consecutiveCriticalCount,
      });

      // Hint GC if enabled and available
      if (config.enableGcHints && global.gc) {
        log.info('Requesting garbage collection');
        global.gc();
      }
    } else if (pressure.level === 'elevated') {
      consecutiveCriticalCount = 0;
      log.warn('Elevated memory pressure', {
        heapUsedPercent: pressure.heapUsedPercent,
        heapUsedMB: Math.round(pressure.heapUsedBytes / 1024 / 1024),
        heapTotalMB: Math.round(pressure.heapTotalBytes / 1024 / 1024),
      });
    } else {
      consecutiveCriticalCount = 0;
    }
  }, config.checkIntervalMs);

  // Don't prevent Node from exiting
  monitorInterval.unref();
}

/**
 * Stop memory monitoring
 */
export function stopMemoryMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    log.info('Memory monitoring stopped');
  }
}

/**
 * Update monitoring configuration at runtime
 */
export function updateConfig(newConfig: Partial<MemoryMonitorConfig>): void {
  config = { ...config, ...newConfig };
  log.info('Memory monitor config updated', {
    elevatedThreshold: config.elevatedThreshold,
    criticalThreshold: config.criticalThreshold,
    checkIntervalMs: config.checkIntervalMs,
    enableGcHints: config.enableGcHints,
  });
}

// =============================================================================
// Express Middleware
// =============================================================================

/**
 * Express middleware for memory pressure backpressure
 * Rejects non-critical requests when memory is critical
 */
export function memoryPressureMiddleware(
  req: { path: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  next: () => void
): void {
  if (shouldAllowRequest(req.path)) {
    next();
  } else {
    log.warn('Request rejected due to memory pressure', { path: req.path });
    res.status(503).json({
      error: 'Service temporarily unavailable',
      reason: 'memory_pressure',
      retryAfter: 30,
    });
  }
}
