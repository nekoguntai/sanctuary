/**
 * In-Memory Rate Limiter
 *
 * Sliding window rate limiter using in-memory storage.
 * Used as fallback when Redis is unavailable.
 */

import type { IRateLimiter, RateLimitResult } from './types';

interface WindowEntry {
  timestamps: number[];
  lastCleanup: number;
}

export class MemoryRateLimiter implements IRateLimiter {
  private windows: Map<string, WindowEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    // Don't keep process alive just for cleanup
    this.cleanupInterval.unref();
  }

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
    cost = 1
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    // Get or create window
    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [], lastCleanup: now };
      this.windows.set(key, entry);
    }

    // Remove old timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    entry.lastCleanup = now;

    const current = entry.timestamps.length;
    const remaining = Math.max(0, limit - current);

    // Check if allowed
    if (current + cost <= limit) {
      // Add timestamps for the cost
      for (let i = 0; i < cost; i++) {
        entry.timestamps.push(now);
      }

      // Calculate reset time
      const oldest = entry.timestamps[0] || now;
      const resetAt = oldest + windowMs;

      return {
        allowed: true,
        remaining: Math.max(0, limit - current - cost),
        limit,
        resetAt,
      };
    }

    // Rate limited
    const oldest = entry.timestamps[0] || now;
    const resetAt = oldest + windowMs;

    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfter: Math.ceil((resetAt - now) / 1000),
    };
  }

  async check(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    const entry = this.windows.get(key);
    if (!entry) {
      return {
        allowed: true,
        remaining: limit,
        limit,
        resetAt: now + windowMs,
      };
    }

    // Count valid timestamps
    const validTimestamps = entry.timestamps.filter((ts) => ts > windowStart);
    const current = validTimestamps.length;
    const remaining = Math.max(0, limit - current);

    const oldest = validTimestamps[0] || now;
    const resetAt = oldest + windowMs;

    return {
      allowed: current < limit,
      remaining,
      limit,
      resetAt,
      retryAfter: current >= limit ? Math.ceil((resetAt - now) / 1000) : undefined,
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  async getRemaining(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<number> {
    const result = await this.check(key, limit, windowSeconds);
    return result.remaining;
  }

  async isHealthy(): Promise<boolean> {
    return true; // In-memory is always healthy
  }

  getType(): string {
    return 'memory';
  }

  /**
   * Clean up old entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [key, entry] of this.windows) {
      // Remove entries that haven't been accessed in a while
      if (now - entry.lastCleanup > staleThreshold) {
        if (entry.timestamps.length === 0) {
          this.windows.delete(key);
        }
      }
    }
  }

  /**
   * Shutdown the limiter (cleanup interval)
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
  }
}
