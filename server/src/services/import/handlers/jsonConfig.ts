/**
 * JSON Config Format Handler
 *
 * Handles custom JSON configuration format with devices array.
 * Format: { type, scriptType, network, quorum?, devices: [...] }
 */

import type { ImportFormatHandler, FormatDetectionResult, ImportParseResult } from '../types';
import { parseJsonImport, validateJsonImport, type JsonImportConfig } from '../../bitcoin/descriptorParser';

/**
 * Check if JSON matches our config format
 */
function isJsonConfigFormat(json: unknown): json is JsonImportConfig {
  if (typeof json !== 'object' || json === null) return false;

  const obj = json as Record<string, unknown>;

  // Must have devices array
  if (!Array.isArray(obj.devices)) return false;

  // Must have type or scriptType
  if (!obj.type && !obj.scriptType) return false;

  return true;
}

export const jsonConfigHandler: ImportFormatHandler = {
  id: 'json',
  name: 'JSON Configuration',
  description: 'Custom JSON format with devices array',
  priority: 60,
  fileExtensions: ['.json'],

  canHandle(input: string): FormatDetectionResult {
    const trimmed = input.trim();

    // Must be JSON
    if (!trimmed.startsWith('{')) {
      return { detected: false, confidence: 0 };
    }

    try {
      const json = JSON.parse(trimmed);

      if (isJsonConfigFormat(json)) {
        // Check for more specific fields to increase confidence
        const hasType = 'type' in json;
        const hasScriptType = 'scriptType' in json;
        const hasNetwork = 'network' in json;
        const hasQuorum = 'quorum' in json;

        const confidence =
          50 +
          (hasType ? 10 : 0) +
          (hasScriptType ? 10 : 0) +
          (hasNetwork ? 10 : 0) +
          (hasQuorum ? 10 : 0);

        return { detected: true, confidence };
      }

      return { detected: false, confidence: 0 };
    } catch {
      return { detected: false, confidence: 0 };
    }
  },

  parse(input: string): ImportParseResult {
    const json = JSON.parse(input.trim()) as JsonImportConfig;

    return {
      parsed: parseJsonImport(json),
      originalDevices: json.devices,
      suggestedName: json.name,
    };
  },

  validate(parsed) {
    // Basic validation
    if (parsed.devices.length === 0) {
      return { valid: false, errors: ['No devices found in configuration'] };
    }

    if (parsed.type === 'multi_sig' && (!parsed.quorum || !parsed.totalSigners)) {
      return { valid: false, errors: ['Multi-sig wallet requires quorum and totalSigners'] };
    }

    return { valid: true };
  },

  extractName(input: string): string | undefined {
    try {
      const json = JSON.parse(input.trim());
      return json.name;
    } catch {
      return undefined;
    }
  },
};
