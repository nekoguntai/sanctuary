/**
 * Device Parser Registry
 *
 * Central registry for device import format parsers.
 * Parsers are checked in priority order (highest first) to detect formats.
 */

import { createLogger } from '../../utils/logger';
import type {
  DeviceParser,
  DeviceParserRegistryConfig,
  DeviceParseResult,
  FormatDetectionResult,
} from './types';

const log = createLogger('DEVICE:PARSER');

/**
 * Device Parser Registry
 *
 * Manages registration and detection of device import format parsers.
 */
class DeviceParserRegistry {
  private parsers: DeviceParser[] = [];
  private config: DeviceParserRegistryConfig;

  constructor(config: DeviceParserRegistryConfig = {}) {
    this.config = config;
  }

  /**
   * Register a new format parser
   * Parsers are sorted by priority (highest first)
   */
  register(parser: DeviceParser): void {
    // Check for duplicate IDs
    const existing = this.parsers.find((p) => p.id === parser.id);
    if (existing) {
      throw new Error(`Device parser '${parser.id}' is already registered`);
    }

    this.parsers.push(parser);
    this.parsers.sort((a, b) => b.priority - a.priority);

    if (this.config.debug) {
      log.debug('Registered device parser', {
        id: parser.id,
        name: parser.name,
        priority: parser.priority,
      });
    }
  }

  /**
   * Unregister a parser by ID
   */
  unregister(id: string): boolean {
    const index = this.parsers.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.parsers.splice(index, 1);
    return true;
  }

  /**
   * Get a parser by ID
   */
  get(id: string): DeviceParser | undefined {
    return this.parsers.find((p) => p.id === id);
  }

  /**
   * Get all registered parsers
   */
  getAll(): DeviceParser[] {
    return [...this.parsers];
  }

  /**
   * Detect which parser can process the input
   * Returns the first parser that reports canParse with detected: true
   */
  detect(data: unknown): DeviceParser | null {
    for (const parser of this.parsers) {
      try {
        const result = parser.canParse(data);
        if (result.detected) {
          if (this.config.debug) {
            log.debug('Format detected', {
              parser: parser.id,
              confidence: result.confidence,
            });
          }
          return parser;
        }
      } catch (error) {
        // canParse should not throw, but handle gracefully
        log.warn('Parser canParse threw error', {
          parser: parser.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  /**
   * Detect format and return detection results from all parsers
   * Useful for debugging or showing format options to user
   */
  detectAll(data: unknown): Array<{ parser: DeviceParser; result: FormatDetectionResult }> {
    const results: Array<{ parser: DeviceParser; result: FormatDetectionResult }> = [];

    for (const parser of this.parsers) {
      try {
        const result = parser.canParse(data);
        results.push({ parser, result });
      } catch {
        results.push({
          parser,
          result: { detected: false, confidence: 0 },
        });
      }
    }

    return results.sort((a, b) => b.result.confidence - a.result.confidence);
  }

  /**
   * Parse input using the appropriate parser
   * Auto-detects format if no parser ID is specified
   * @param data JSON object or raw string to parse
   * @param parserId Optional specific parser to use
   * @returns Parsed result with format ID, or null if no parser could handle it
   */
  parse(data: unknown, parserId?: string): (DeviceParseResult & { format: string }) | null {
    let parser: DeviceParser | null | undefined;

    if (parserId) {
      parser = this.get(parserId);
      if (!parser) {
        log.warn('Unknown device parser requested', { parserId });
        return null;
      }
    } else {
      parser = this.detect(data);
      if (!parser) {
        if (this.config.debug) {
          log.debug('No parser detected for input');
        }
        return null;
      }
    }

    try {
      const result = parser.parse(data);

      return {
        ...result,
        format: parser.id,
      };
    } catch (error) {
      log.warn('Parser threw error during parse', {
        parser: parser.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Parse JSON string, handling JSON.parse internally
   * Convenience method for raw string input
   */
  parseJson(jsonString: string): (DeviceParseResult & { format: string }) | null {
    try {
      const data = JSON.parse(jsonString);
      return this.parse(data);
    } catch {
      // Not valid JSON, try parsing as raw string
      return this.parse(jsonString);
    }
  }

  /**
   * Get parser count
   */
  get count(): number {
    return this.parsers.length;
  }

  /**
   * Get registry statistics for debugging/testing
   */
  getStats(): { parserCount: number; parsers: Array<{ id: string; name: string; priority: number }> } {
    return {
      parserCount: this.parsers.length,
      parsers: this.parsers.map((p) => ({
        id: p.id,
        name: p.name,
        priority: p.priority,
      })),
    };
  }
}

// Singleton instance
export const deviceParserRegistry = new DeviceParserRegistry({ debug: false });

// Also export class for testing
export { DeviceParserRegistry };
