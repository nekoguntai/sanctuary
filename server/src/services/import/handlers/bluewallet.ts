/**
 * BlueWallet Text Format Handler
 *
 * Handles text exports from BlueWallet/Coldcard with format:
 * Name: <wallet name>
 * Policy: M of N
 * Format: P2WSH
 * ...
 */

import type { ImportFormatHandler, FormatDetectionResult, ImportParseResult } from '../types';
import {
  parseBlueWalletText,
  parseBlueWalletTextImport,
  isBlueWalletTextFormat,
} from '../../bitcoin/descriptorParser';

export const bluewalletHandler: ImportFormatHandler = {
  id: 'bluewallet_text',
  name: 'BlueWallet/Coldcard Text',
  description: 'Text export with Name/Policy/Format fields',
  priority: 75,
  fileExtensions: ['.txt'],

  canHandle(input: string): FormatDetectionResult {
    const trimmed = input.trim();

    // Don't handle JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return { detected: false, confidence: 0 };
    }

    if (isBlueWalletTextFormat(trimmed)) {
      // Check for specific markers to increase confidence
      const hasName = /^Name:/im.test(trimmed);
      const hasPolicy = /^Policy:/im.test(trimmed);
      const hasFormat = /^Format:/im.test(trimmed);

      const confidence = 70 + (hasName ? 10 : 0) + (hasPolicy ? 10 : 0) + (hasFormat ? 5 : 0);
      return { detected: true, confidence };
    }

    return { detected: false, confidence: 0 };
  },

  parse(input: string): ImportParseResult {
    const trimmed = input.trim();
    const blueWalletParsed = parseBlueWalletText(trimmed);

    return {
      parsed: parseBlueWalletTextImport(trimmed),
      suggestedName: blueWalletParsed.name,
    };
  },

  extractName(input: string): string | undefined {
    try {
      const result = parseBlueWalletText(input.trim());
      return result.name;
    } catch {
      return undefined;
    }
  },
};
