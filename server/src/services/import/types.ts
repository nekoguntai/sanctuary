/**
 * Import Format Types
 *
 * Defines interfaces for the pluggable import format system.
 * New import formats can be added by implementing ImportFormatHandler.
 */

import type {
  ParsedDescriptor as ParsedDescriptorType,
  ParsedDevice as ParsedDeviceType,
  ScriptType,
  JsonImportDevice,
} from '../bitcoin/descriptorParser';

// Re-export types for use by handlers
export type ParsedDescriptor = ParsedDescriptorType;
export type ParsedDevice = ParsedDeviceType;

/**
 * Result of format detection
 */
export interface FormatDetectionResult {
  detected: boolean;
  confidence: number; // 0-100, higher = more confident
}

/**
 * Result of parsing an import
 */
export interface ImportParseResult {
  parsed: ParsedDescriptor;
  originalDevices?: JsonImportDevice[];
  suggestedName?: string;
  availablePaths?: Array<{ scriptType: ScriptType; path: string }>;
}

/**
 * Validation result
 */
export interface ImportValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Import format handler interface
 *
 * Implement this interface to add support for a new import format.
 * Register the handler with importFormatRegistry.register()
 */
export interface ImportFormatHandler {
  /** Unique identifier for this format */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Description of what this format supports */
  readonly description: string;

  /**
   * Priority for format detection (higher = checked first)
   * Use 90+ for specific formats, 50-89 for generic, 10-49 for fallbacks
   */
  readonly priority: number;

  /**
   * File extensions this format typically uses (for file picker hints)
   */
  readonly fileExtensions?: string[];

  /**
   * Check if this handler can process the input
   * Should be fast and not throw errors
   */
  canHandle(input: string): FormatDetectionResult;

  /**
   * Parse the input into a ParsedDescriptor
   * Only called if canHandle() returned detected: true
   */
  parse(input: string): ImportParseResult;

  /**
   * Validate the parsed result (optional)
   * Called after parse() to check for issues
   */
  validate?(parsed: ParsedDescriptor): ImportValidationResult;

  /**
   * Extract a suggested wallet name from the input (optional)
   */
  extractName?(input: string): string | undefined;
}

/**
 * Registry configuration
 */
export interface ImportFormatRegistryConfig {
  /** Enable debug logging */
  debug?: boolean;
}
