/**
 * Backup Service
 *
 * Handles database backup and restore operations for Sanctuary.
 * Supports forward compatibility through schema versioning and migrations.
 *
 * Usage:
 *   const backupService = new BackupService();
 *   const backup = await backupService.createBackup('admin', { includeCache: false });
 *   const validation = await backupService.validateBackup(backup);
 *   const result = await backupService.restoreFromBackup(backup);
 *
 * Backup Format Version History:
 *   1.0.0 - Initial backup format
 *
 * SECURITY CONSIDERATIONS FOR BACKUP ENCRYPTION:
 * ================================================
 * Current Status: Backups are exported as unencrypted JSON files.
 *
 * Sensitive Data in Backups:
 *   - User password hashes (bcrypt) - Already hashed, relatively safe
 *   - Node configuration passwords (AES-256-GCM encrypted)
 *   - 2FA secrets and backup codes (stored encrypted)
 *   - Wallet descriptors and xpubs (sensitive financial data)
 *   - Transaction history and addresses
 *
 * Recommendation:
 *   While password hashes and node passwords are already protected, we recommend:
 *
 *   1. IMMEDIATE: Users should store backup files in encrypted storage (e.g.,
 *      encrypted disk, password manager, or encrypted cloud storage).
 *
 *   2. FUTURE ENHANCEMENT: Add optional client-side encryption for backup exports
 *      using a user-provided passphrase. This would encrypt the entire backup
 *      JSON before download using AES-256-GCM with a key derived from the
 *      passphrase via Argon2id or scrypt.
 *
 *   3. DO NOT implement server-side backup encryption with a stored key, as this
 *      provides no real security benefit - if the server is compromised, the
 *      encryption key would also be compromised.
 *
 * The current approach is acceptable because:
 *   - Backups require admin authentication to create
 *   - Sensitive passwords are already encrypted/hashed
 *   - Users are responsible for secure storage of exported files
 *   - The restore process requires explicit confirmation
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import { version as appVersion } from '../../package.json';
import { migrationService, getExpectedSchemaVersion } from './migrationService';
import { isEncrypted, decrypt } from '../utils/encryption';

const log = createLogger('BACKUP');

// Current backup format version
const BACKUP_FORMAT_VERSION = '1.0.0';

/**
 * Tables in dependency order for export/import.
 * Tables with no foreign keys come first, then tables that depend on them.
 */
const TABLE_ORDER = [
  // Independent tables (no foreign keys)
  'hardwareDeviceModel',  // Prisma model name
  'systemSetting',
  'nodeConfig',
  'user',
  'group',

  // First-level dependencies
  'groupMember',     // FK: userId, groupId
  'device',          // FK: userId, modelId
  'wallet',          // FK: groupId
  'pushDevice',      // FK: userId

  // Second-level dependencies
  'walletUser',      // FK: walletId, userId
  'walletDevice',    // FK: walletId, deviceId
  'address',         // FK: walletId
  'label',           // FK: walletId
  'draftTransaction', // FK: walletId, userId

  // Third-level dependencies
  'transaction',     // FK: walletId, userId, addressId
  'uTXO',            // FK: walletId

  // Fourth-level dependencies
  'transactionLabel', // FK: transactionId, labelId
  'addressLabel',     // FK: addressId, labelId

  // Independent tables (no FK) - placed last for logical grouping
  'auditLog',         // No FK (userId stored as string for history)
] as const;

// Optional cache tables (excluded by default)
const CACHE_TABLES = ['priceData', 'feeEstimate'] as const;

/**
 * Backup metadata
 */
export interface BackupMeta {
  version: string;           // Backup format version
  appVersion: string;        // Sanctuary app version
  schemaVersion: number;     // Database schema version
  createdAt: string;         // ISO timestamp
  createdBy: string;         // Admin username
  description?: string;      // Optional description
  includesCache: boolean;    // Whether cache tables are included
  recordCounts: Record<string, number>; // Per-table record counts
}

/**
 * Complete backup structure
 */
export interface SanctuaryBackup {
  meta: BackupMeta;
  data: Record<string, any[]>;
}

/**
 * Backup creation options
 */
export interface BackupOptions {
  includeCache?: boolean;
  description?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  issues: string[];      // Critical issues (prevent restore)
  warnings: string[];    // Non-critical warnings
  info: {
    createdAt: string;
    appVersion: string;
    schemaVersion: number;
    totalRecords: number;
    tables: string[];
  };
}

/**
 * Restore result
 */
export interface RestoreResult {
  success: boolean;
  tablesRestored: number;
  recordsRestored: number;
  warnings: string[];
  error?: string;
}

/**
 * Backup migration function
 */
interface BackupMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (backup: SanctuaryBackup) => SanctuaryBackup;
}

/**
 * Migration registry for forward compatibility.
 * Add migrations here when schema changes.
 *
 * Example migration:
 * {
 *   fromVersion: 1,
 *   toVersion: 2,
 *   migrate: (backup) => {
 *     // Add new field with default value
 *     backup.data.user = backup.data.user.map(u => ({
 *       ...u,
 *       newField: 'default'
 *     }));
 *     return backup;
 *   }
 * }
 */
const MIGRATIONS: BackupMigration[] = [
  // Migrations will be added here as schema evolves
];

/**
 * BackupService class
 */
export class BackupService {
  /**
   * Create a complete database backup
   */
  async createBackup(adminUser: string, options: BackupOptions = {}): Promise<SanctuaryBackup> {
    const { includeCache = false, description } = options;

    log.info('[BACKUP] Creating backup', { adminUser, includeCache });

    const data: Record<string, any[]> = {};
    const recordCounts: Record<string, number> = {};

    // Export all tables in dependency order
    const tablesToExport = includeCache
      ? [...TABLE_ORDER, ...CACHE_TABLES]
      : TABLE_ORDER;

    for (const table of tablesToExport) {
      try {
        // @ts-ignore - Dynamic table access
        const records = await prisma[table].findMany();
        // Convert BigInt values to strings for JSON serialization
        data[table] = records.map((record: any) => this.serializeRecord(record));
        recordCounts[table] = records.length;
        log.debug(`[BACKUP] Exported ${records.length} records from ${table}`);
      } catch (error) {
        log.warn(`[BACKUP] Failed to export table ${table}`, { error: String(error) });
        data[table] = [];
        recordCounts[table] = 0;
      }
    }

    // Get current schema version from applied migrations
    const schemaVersion = await migrationService.getSchemaVersion();

    const backup: SanctuaryBackup = {
      meta: {
        version: BACKUP_FORMAT_VERSION,
        appVersion,
        schemaVersion,
        createdAt: new Date().toISOString(),
        createdBy: adminUser,
        description,
        includesCache: includeCache,
        recordCounts,
      },
      data,
    };

    const totalRecords = Object.values(recordCounts).reduce((a, b) => a + b, 0);
    log.info('[BACKUP] Backup created', { totalRecords, tables: Object.keys(data).length });

    return backup;
  }

  /**
   * Validate a backup file before restore
   */
  async validateBackup(backup: any): Promise<ValidationResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Get current schema version for comparison
    const currentSchemaVersion = await migrationService.getSchemaVersion();

    // Structure validation
    if (!backup || typeof backup !== 'object') {
      issues.push('Invalid backup format: not an object');
      return {
        valid: false,
        issues,
        warnings,
        info: { createdAt: '', appVersion: '', schemaVersion: 0, totalRecords: 0, tables: [] },
      };
    }

    if (!backup.meta) {
      issues.push('Missing meta section');
    }

    if (!backup.data) {
      issues.push('Missing data section');
    }

    if (issues.length > 0) {
      return {
        valid: false,
        issues,
        warnings,
        info: { createdAt: '', appVersion: '', schemaVersion: 0, totalRecords: 0, tables: [] },
      };
    }

    const meta = backup.meta as BackupMeta;

    // Version validation
    if (!meta.version) {
      issues.push('Missing backup format version');
    }

    if (!meta.appVersion) {
      warnings.push('Missing app version');
    }

    if (meta.schemaVersion === undefined) {
      issues.push('Missing schema version');
    } else if (meta.schemaVersion > currentSchemaVersion) {
      issues.push(`Backup schema version (${meta.schemaVersion}) is newer than current (${currentSchemaVersion}). Cannot restore from future version.`);
    }

    // Data validation
    const data = backup.data as Record<string, any[]>;
    const tables = Object.keys(data);

    // Check for required tables
    for (const table of TABLE_ORDER) {
      if (!data[table]) {
        warnings.push(`Missing table: ${table}`);
      } else if (!Array.isArray(data[table])) {
        issues.push(`Table ${table} is not an array`);
      }
    }

    // Users validation
    if (data.user && Array.isArray(data.user)) {
      if (data.user.length === 0) {
        issues.push('Backup must contain at least one user');
      } else {
        const hasAdmin = data.user.some((u: any) => u.isAdmin === true);
        if (!hasAdmin) {
          issues.push('Backup must contain at least one admin user');
        }
      }
    }

    // Referential integrity checks
    if (data.user && data.device) {
      const userIds = new Set(data.user.map((u: any) => u.id));
      for (const device of data.device) {
        if (!userIds.has(device.userId)) {
          issues.push(`Device ${device.id} references non-existent user ${device.userId}`);
        }
      }
    }

    if (data.wallet && data.walletUser && data.user) {
      const walletIds = new Set(data.wallet.map((w: any) => w.id));
      const userIds = new Set(data.user.map((u: any) => u.id));
      for (const wu of data.walletUser) {
        if (!walletIds.has(wu.walletId)) {
          issues.push(`WalletUser references non-existent wallet ${wu.walletId}`);
        }
        if (!userIds.has(wu.userId)) {
          issues.push(`WalletUser references non-existent user ${wu.userId}`);
        }
      }
    }

    // Calculate total records
    let totalRecords = 0;
    for (const table of tables) {
      if (Array.isArray(data[table])) {
        totalRecords += data[table].length;
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings,
      info: {
        createdAt: meta.createdAt || '',
        appVersion: meta.appVersion || '',
        schemaVersion: meta.schemaVersion || 0,
        totalRecords,
        tables,
      },
    };
  }

  /**
   * Restore database from backup
   * WARNING: This will DELETE ALL existing data
   */
  async restoreFromBackup(backup: SanctuaryBackup): Promise<RestoreResult> {
    const warnings: string[] = [];
    let tablesRestored = 0;
    let recordsRestored = 0;

    // Get current schema version
    const currentSchemaVersion = await migrationService.getSchemaVersion();

    log.info('[BACKUP] Starting restore', {
      backupDate: backup.meta.createdAt,
      schemaVersion: backup.meta.schemaVersion,
      currentSchemaVersion,
    });

    // Apply migrations if needed
    let migratedBackup = backup;
    if (backup.meta.schemaVersion < currentSchemaVersion) {
      log.info('[BACKUP] Migrating backup from schema version', {
        from: backup.meta.schemaVersion,
        to: currentSchemaVersion,
      });
      migratedBackup = this.migrateBackup(backup, currentSchemaVersion);
    }

    try {
      // Use Prisma transaction for atomicity
      await prisma.$transaction(async (tx) => {
        // Delete all tables in REVERSE order (to handle foreign key constraints)
        const allTables = migratedBackup.meta.includesCache
          ? [...TABLE_ORDER, ...CACHE_TABLES]
          : [...TABLE_ORDER];

        log.debug('[BACKUP] Deleting existing data in reverse order');
        for (const table of [...allTables].reverse()) {
          try {
            // @ts-ignore - Dynamic table access
            await tx[table].deleteMany({});
            log.debug(`[BACKUP] Deleted all records from ${table}`);
          } catch (error) {
            log.warn(`[BACKUP] Failed to delete from ${table}`, { error: String(error) });
          }
        }

        // Insert data in FORWARD order (respects foreign key dependencies)
        log.debug('[BACKUP] Inserting backup data in forward order');
        for (const table of allTables) {
          const records = migratedBackup.data[table];
          if (!records || !Array.isArray(records) || records.length === 0) {
            continue;
          }

          try {
            // Handle DateTime fields (they come as strings from JSON)
            let processedRecords = records.map((record) => this.processRecord(record));

            // Special handling for nodeConfig - check if encrypted passwords can be decrypted
            if (table === 'nodeConfig') {
              processedRecords = processedRecords.map((record) => {
                if (record.password && isEncrypted(record.password)) {
                  try {
                    // Try to decrypt with current ENCRYPTION_KEY
                    decrypt(record.password);
                    // If successful, keep the password
                  } catch (error) {
                    // Can't decrypt - password was encrypted with different key
                    log.warn('[BACKUP] Node config password cannot be decrypted (different ENCRYPTION_KEY)', {
                      nodeType: record.type,
                    });
                    warnings.push(
                      `Node configuration password could not be restored (encrypted with different key). Please update your ${record.type || 'node'} password in Settings > Node Configuration.`
                    );
                    // Clear the password so user knows to re-enter it
                    return { ...record, password: null };
                  }
                }
                return record;
              });
            }

            // Use createMany for bulk insert
            // @ts-ignore - Dynamic table access
            await tx[table].createMany({
              data: processedRecords,
              skipDuplicates: false,
            });

            tablesRestored++;
            recordsRestored += records.length;
            log.debug(`[BACKUP] Restored ${records.length} records to ${table}`);
          } catch (error) {
            const errorMsg = `Failed to restore table ${table}: ${String(error)}`;
            log.error('[BACKUP] ' + errorMsg);
            throw new Error(errorMsg);
          }
        }
      }, {
        timeout: 120000, // 2 minute timeout for large restores
      });

      log.info('[BACKUP] Restore completed', { tablesRestored, recordsRestored });

      return {
        success: true,
        tablesRestored,
        recordsRestored,
        warnings,
      };
    } catch (error) {
      log.error('[BACKUP] Restore failed, transaction rolled back', { error: String(error) });
      return {
        success: false,
        tablesRestored: 0,
        recordsRestored: 0,
        warnings,
        error: String(error),
      };
    }
  }

  /**
   * Serialize a record for JSON export (converts BigInt to string)
   */
  private serializeRecord(record: any): any {
    const serialized: any = {};

    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value === 'bigint') {
        // Store BigInt as string with special marker for restore
        serialized[key] = `__bigint__${value.toString()}`;
      } else if (value instanceof Date) {
        serialized[key] = value.toISOString();
      } else if (value !== null && typeof value === 'object') {
        // Recursively handle nested objects
        serialized[key] = this.serializeRecord(value);
      } else {
        serialized[key] = value;
      }
    }

    return serialized;
  }

  /**
   * Process a record to convert string dates back to Date objects
   * and BigInt markers back to BigInt
   */
  private processRecord(record: any): any {
    const processed = { ...record };

    for (const key of Object.keys(processed)) {
      const value = processed[key];
      if (typeof value === 'string') {
        // Check for BigInt marker
        if (value.startsWith('__bigint__')) {
          processed[key] = BigInt(value.replace('__bigint__', ''));
        }
        // Check for ISO date string
        else if (this.isISODateString(value)) {
          processed[key] = new Date(value);
        }
      }
    }

    return processed;
  }

  /**
   * Check if a string is an ISO date string
   */
  private isISODateString(value: string): boolean {
    // Match ISO 8601 date format
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    return isoDateRegex.test(value);
  }

  /**
   * Apply migrations to upgrade backup to current schema version
   */
  private migrateBackup(backup: SanctuaryBackup, targetVersion: number): SanctuaryBackup {
    let current = { ...backup, data: { ...backup.data } };
    const startVersion = backup.meta.schemaVersion;

    for (const migration of MIGRATIONS) {
      if (startVersion < migration.toVersion && current.meta.schemaVersion < migration.toVersion) {
        log.debug(`[BACKUP] Applying migration ${migration.fromVersion} -> ${migration.toVersion}`);
        current = migration.migrate(current);
        current.meta.schemaVersion = migration.toVersion;
      }
    }

    // Update to target version even if no migrations defined
    // (schema may have changed without needing data transformation)
    current.meta.schemaVersion = targetVersion;

    return current;
  }

  /**
   * Get current schema version from applied migrations
   */
  async getSchemaVersion(): Promise<number> {
    return migrationService.getSchemaVersion();
  }

  /**
   * Get backup format version
   */
  getFormatVersion(): string {
    return BACKUP_FORMAT_VERSION;
  }
}

// Export singleton instance
export const backupService = new BackupService();
