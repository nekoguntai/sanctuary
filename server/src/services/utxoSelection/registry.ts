/**
 * UTXO Selection Strategy Registry
 *
 * Central registry for UTXO selection strategies.
 */

import { createLogger } from '../../utils/logger';
import type { SelectionStrategyHandler, SelectionContext, SelectionResult } from './types';

const log = createLogger('UTXO:REGISTRY');

/**
 * Selection Strategy Registry
 *
 * Manages registration and lookup of selection strategies.
 */
class SelectionStrategyRegistry {
  private handlers: Map<string, SelectionStrategyHandler> = new Map();

  /**
   * Register a new strategy handler
   */
  register(handler: SelectionStrategyHandler): void {
    if (this.handlers.has(handler.id)) {
      throw new Error(`Selection strategy '${handler.id}' is already registered`);
    }

    this.handlers.set(handler.id, handler);
    log.debug('Registered selection strategy', {
      id: handler.id,
      name: handler.name,
      tags: handler.tags,
    });
  }

  /**
   * Unregister a strategy by ID
   */
  unregister(id: string): boolean {
    return this.handlers.delete(id);
  }

  /**
   * Get a handler by ID
   */
  get(id: string): SelectionStrategyHandler | undefined {
    return this.handlers.get(id);
  }

  /**
   * Get all registered handlers sorted by priority
   */
  getAll(): SelectionStrategyHandler[] {
    return Array.from(this.handlers.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all strategy IDs
   */
  getIds(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a strategy is registered
   */
  has(id: string): boolean {
    return this.handlers.has(id);
  }

  /**
   * Get strategies by tag
   */
  getByTag(tag: string): SelectionStrategyHandler[] {
    return this.getAll().filter((h) => h.tags.includes(tag));
  }

  /**
   * Select UTXOs using the specified strategy
   */
  select(strategyId: string, context: SelectionContext): SelectionResult {
    const handler = this.get(strategyId);
    if (!handler) {
      // Fallback to efficiency if strategy not found
      const fallback = this.get('efficiency');
      if (fallback) {
        log.warn(`Strategy '${strategyId}' not found, falling back to efficiency`);
        return fallback.select(context);
      }
      throw new Error(`Selection strategy '${strategyId}' not found`);
    }

    return handler.select(context);
  }

  /**
   * Get handler count
   */
  get count(): number {
    return this.handlers.size;
  }

  /**
   * Get strategy info for API/UI
   */
  getStrategyInfo(): Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }> {
    return this.getAll().map((h) => ({
      id: h.id,
      name: h.name,
      description: h.description,
      tags: h.tags,
    }));
  }
}

// Singleton instance
export const selectionStrategyRegistry = new SelectionStrategyRegistry();

// Also export class for testing
export { SelectionStrategyRegistry };
