/**
 * Export Format Registry
 *
 * Central registry for wallet export format handlers.
 * Allows registration of new export formats.
 */

import { createLogger } from '../../utils/logger';
import type {
  ExportFormatHandler,
  ExportFormatRegistryConfig,
  WalletExportData,
  ExportOptions,
  ExportResult,
} from './types';

const log = createLogger('EXPORT:REGISTRY');

/**
 * Export Format Registry
 */
class ExportFormatRegistry {
  private handlers: Map<string, ExportFormatHandler> = new Map();
  private config: ExportFormatRegistryConfig;

  constructor(config: ExportFormatRegistryConfig = {}) {
    this.config = config;
  }

  /**
   * Register a new export format handler
   */
  register(handler: ExportFormatHandler): void {
    if (this.handlers.has(handler.id)) {
      throw new Error(`Export format handler '${handler.id}' is already registered`);
    }

    this.handlers.set(handler.id, handler);

    if (this.config.debug) {
      log.debug('Registered export format handler', {
        id: handler.id,
        name: handler.name,
        extension: handler.fileExtension,
      });
    }
  }

  /**
   * Unregister a format handler by ID
   */
  unregister(id: string): boolean {
    return this.handlers.delete(id);
  }

  /**
   * Get a handler by ID
   */
  get(id: string): ExportFormatHandler | undefined {
    return this.handlers.get(id);
  }

  /**
   * Get all registered handlers
   */
  getAll(): ExportFormatHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Get all format IDs
   */
  getIds(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a format is registered
   */
  has(id: string): boolean {
    return this.handlers.has(id);
  }

  /**
   * Get formats that can export the given wallet
   */
  getAvailableFormats(wallet: WalletExportData): ExportFormatHandler[] {
    return this.getAll().filter((handler) => {
      if (handler.canExport) {
        return handler.canExport(wallet);
      }
      return true;
    });
  }

  /**
   * Export wallet in the specified format
   */
  export(
    formatId: string,
    wallet: WalletExportData,
    options?: ExportOptions
  ): ExportResult {
    const handler = this.get(formatId);
    if (!handler) {
      throw new Error(`Unknown export format: ${formatId}`);
    }

    if (handler.canExport && !handler.canExport(wallet)) {
      throw new Error(
        `Export format '${formatId}' cannot export this wallet type`
      );
    }

    if (this.config.debug) {
      log.debug('Exporting wallet', {
        format: formatId,
        walletId: wallet.id,
        walletType: wallet.type,
      });
    }

    return handler.export(wallet, options);
  }

  /**
   * Get format info for UI display
   */
  getFormatInfo(): Array<{
    id: string;
    name: string;
    description: string;
    extension: string;
    mimeType: string;
  }> {
    return this.getAll().map((h) => ({
      id: h.id,
      name: h.name,
      description: h.description,
      extension: h.fileExtension,
      mimeType: h.mimeType,
    }));
  }

  /**
   * Get handler count
   */
  get count(): number {
    return this.handlers.size;
  }
}

// Singleton instance
export const exportFormatRegistry = new ExportFormatRegistry({ debug: false });

// Also export class for testing
export { ExportFormatRegistry };
