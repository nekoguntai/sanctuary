/**
 * Import Format Registry
 *
 * Central registry for wallet import format handlers.
 * Handlers are checked in priority order (highest first) to detect formats.
 */

import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type {
  ImportFormatHandler,
  ImportFormatRegistryConfig,
  ImportParseResult,
  FormatDetectionResult,
} from './types';

const log = createLogger('IMPORT:REGISTRY');

/**
 * Import Format Registry
 *
 * Manages registration and detection of import format handlers.
 */
class ImportFormatRegistry {
  private handlers: ImportFormatHandler[] = [];
  private config: ImportFormatRegistryConfig;

  constructor(config: ImportFormatRegistryConfig = {}) {
    this.config = config;
  }

  /**
   * Register a new format handler
   * Handlers are sorted by priority (highest first)
   */
  register(handler: ImportFormatHandler): void {
    // Check for duplicate IDs
    const existing = this.handlers.find((h) => h.id === handler.id);
    if (existing) {
      throw new Error(`Import format handler '${handler.id}' is already registered`);
    }

    this.handlers.push(handler);
    this.handlers.sort((a, b) => b.priority - a.priority);

    if (this.config.debug) {
      log.debug('Registered import format handler', {
        id: handler.id,
        name: handler.name,
        priority: handler.priority,
      });
    }
  }

  /**
   * Unregister a format handler by ID
   */
  unregister(id: string): boolean {
    const index = this.handlers.findIndex((h) => h.id === id);
    if (index === -1) return false;

    this.handlers.splice(index, 1);
    return true;
  }

  /**
   * Get a handler by ID
   */
  get(id: string): ImportFormatHandler | undefined {
    return this.handlers.find((h) => h.id === id);
  }

  /**
   * Get all registered handlers
   */
  getAll(): ImportFormatHandler[] {
    return [...this.handlers];
  }

  /**
   * Detect which handler can process the input
   * Returns the first handler that reports canHandle with detected: true
   */
  detect(input: string): ImportFormatHandler | null {
    for (const handler of this.handlers) {
      try {
        const result = handler.canHandle(input);
        if (result.detected) {
          if (this.config.debug) {
            log.debug('Format detected', {
              handler: handler.id,
              confidence: result.confidence,
            });
          }
          return handler;
        }
      } catch (error) {
        // canHandle should not throw, but handle gracefully
        log.warn('Handler canHandle threw error', {
          handler: handler.id,
          error: getErrorMessage(error),
        });
      }
    }

    return null;
  }

  /**
   * Detect format and return detection results from all handlers
   * Useful for debugging or showing format options to user
   */
  detectAll(input: string): Array<{ handler: ImportFormatHandler; result: FormatDetectionResult }> {
    const results: Array<{ handler: ImportFormatHandler; result: FormatDetectionResult }> = [];

    for (const handler of this.handlers) {
      try {
        const result = handler.canHandle(input);
        results.push({ handler, result });
      } catch (error) {
        results.push({
          handler,
          result: { detected: false, confidence: 0 },
        });
      }
    }

    return results.sort((a, b) => b.result.confidence - a.result.confidence);
  }

  /**
   * Parse input using the appropriate handler
   * Auto-detects format if no handler ID is specified
   */
  parse(input: string, handlerId?: string): ImportParseResult & { format: string } {
    let handler: ImportFormatHandler | null | undefined;

    if (handlerId) {
      handler = this.get(handlerId);
      if (!handler) {
        throw new Error(`Unknown import format handler: ${handlerId}`);
      }
    } else {
      handler = this.detect(input);
      if (!handler) {
        throw new Error('Unable to detect import format. Please check the input format.');
      }
    }

    const result = handler.parse(input);

    // Run validation if handler supports it
    if (handler.validate) {
      const validation = handler.validate(result.parsed);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors?.join(', ') || 'Unknown error'}`);
      }
    }

    return {
      ...result,
      format: handler.id,
    };
  }

  /**
   * Get file extension hints for file picker
   */
  getFileExtensions(): string[] {
    const extensions = new Set<string>();
    for (const handler of this.handlers) {
      if (handler.fileExtensions) {
        for (const ext of handler.fileExtensions) {
          extensions.add(ext);
        }
      }
    }
    return Array.from(extensions);
  }

  /**
   * Get handler count
   */
  get count(): number {
    return this.handlers.length;
  }
}

// Singleton instance
export const importFormatRegistry = new ImportFormatRegistry({ debug: false });

// Also export class for testing
export { ImportFormatRegistry };
