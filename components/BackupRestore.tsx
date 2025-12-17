/**
 * Backup & Restore Component
 *
 * Admin-only page for creating database backups and restoring from backup files.
 * Accessible from Administration > Backup & Restore in the sidebar.
 */

import React, { useState, useRef } from 'react';
import { Button } from './ui/Button';
import {
  Database,
  Download,
  Upload,
  AlertTriangle,
  Check,
  AlertCircle,
  FileJson,
  Clock,
  User,
  Layers,
  X,
} from 'lucide-react';
import * as adminApi from '../src/api/admin';
import type { SanctuaryBackup, ValidationResult } from '../src/api/admin';
import { createLogger } from '../utils/logger';
import { useAppNotifications } from '../contexts/AppNotificationContext';

const log = createLogger('BackupRestore');

export const BackupRestore: React.FC = () => {
  const { addNotification } = useAppNotifications();

  // Backup state
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [includeCache, setIncludeCache] = useState(false);
  const [description, setDescription] = useState('');
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSuccess, setBackupSuccess] = useState(false);

  // Restore state
  const [uploadedBackup, setUploadedBackup] = useState<SanctuaryBackup | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Create and download a backup
   */
  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    setBackupError(null);
    setBackupSuccess(false);

    try {
      const blob = await adminApi.createBackup({
        includeCache,
        description: description.trim() || undefined,
      });

      // Create download link
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString()
        .slice(0, 19)
        .replace(/[T:]/g, '-');
      const filename = `sanctuary-backup-${timestamp}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupSuccess(true);
      setDescription('');
      setTimeout(() => setBackupSuccess(false), 5000);
    } catch (error) {
      log.error('Backup failed', { error });
      setBackupError(error instanceof Error ? error.message : 'Failed to create backup');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  /**
   * Handle file upload
   */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setUploadedBackup(null);
    setValidationResult(null);
    setRestoreError(null);
    setRestoreSuccess(false);

    try {
      const text = await file.text();
      const backup = JSON.parse(text) as SanctuaryBackup;
      setUploadedBackup(backup);
      setUploadedFileName(file.name);

      // Auto-validate
      await validateBackup(backup);
    } catch (error) {
      log.error('Failed to parse backup file', { error });
      setRestoreError('Invalid backup file format. Please select a valid Sanctuary backup JSON file.');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Validate the uploaded backup
   */
  const validateBackup = async (backup: SanctuaryBackup) => {
    setIsValidating(true);
    setRestoreError(null);

    try {
      const result = await adminApi.validateBackup(backup);
      setValidationResult(result);
    } catch (error) {
      log.error('Validation failed', { error });
      setRestoreError('Failed to validate backup file');
    } finally {
      setIsValidating(false);
    }
  };

  /**
   * Perform the restore
   */
  const handleRestore = async () => {
    if (!uploadedBackup || confirmText !== 'RESTORE') return;

    setIsRestoring(true);
    setRestoreError(null);
    setShowConfirmModal(false);
    setConfirmText('');

    try {
      const result = await adminApi.restoreBackup(uploadedBackup);

      if (result.success) {
        setRestoreSuccess(true);
        setUploadedBackup(null);
        setUploadedFileName(null);
        setValidationResult(null);

        // Show warnings as notifications (e.g., node passwords that couldn't be restored)
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((warning) => {
            addNotification({
              type: 'warning',
              scope: 'global',
              title: 'Restore Warning',
              message: warning,
              persistent: true,
            });
          });
        }

        // Reload the page after successful restore to refresh all data
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        setRestoreError(result.error || 'Restore failed');
      }
    } catch (error) {
      log.error('Restore failed', { error });
      setRestoreError(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      setIsRestoring(false);
    }
  };

  /**
   * Clear uploaded backup
   */
  const handleClearUpload = () => {
    setUploadedBackup(null);
    setUploadedFileName(null);
    setValidationResult(null);
    setRestoreError(null);
  };

  /**
   * Format date for display
   */
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Backup & Restore</h2>
        <p className="text-sanctuary-500">Create database backups and restore from backup files</p>
      </div>

      {/* Create Backup Section */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Create Backup</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
            Create a complete backup of the database including users, wallets, transactions, and settings.
            The backup file can be used to restore data to this or another Sanctuary instance.
          </p>

          {/* Options */}
          <div className="space-y-4">
            {/* Include Cache Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Include cache data
                </label>
                <p className="text-xs text-sanctuary-500">
                  Include price history and fee estimates (can be regenerated)
                </p>
              </div>
              <button
                onClick={() => setIncludeCache(!includeCache)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                  includeCache ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    includeCache ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Before migration, Weekly backup"
                className="w-full px-3 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Create Button */}
          <Button
            onClick={handleCreateBackup}
            disabled={isCreatingBackup}
            className="w-full"
          >
            {isCreatingBackup ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Creating Backup...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Download Backup
              </>
            )}
          </Button>

          {/* Success/Error Messages */}
          {backupSuccess && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">Backup created and downloaded successfully</span>
            </div>
          )}

          {backupError && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{backupError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Restore Section */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-warning-600 dark:text-warning-500">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Restore from Backup</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Warning */}
          <div className="flex items-start space-x-3 p-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
            <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-warning-700 dark:text-warning-300">
              <strong>Warning:</strong> Restoring from a backup will <strong>delete all existing data</strong> and
              replace it with the backup contents. This action cannot be undone.
            </div>
          </div>

          {/* File Upload */}
          {!uploadedBackup ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-sanctuary-300 dark:border-sanctuary-700 rounded-xl p-8 text-center cursor-pointer hover:border-primary-500 dark:hover:border-primary-500 transition-colors"
            >
              <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-4" />
              <p className="text-sanctuary-600 dark:text-sanctuary-400 mb-2">
                Drop backup file here or click to browse
              </p>
              <p className="text-xs text-sanctuary-500">
                Accepts .json backup files created by Sanctuary
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Uploaded File Info */}
              <div className="flex items-center justify-between p-4 surface-secondary rounded-lg border border-sanctuary-200 dark:border-sanctuary-700">
                <div className="flex items-center space-x-3">
                  <FileJson className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                  <div>
                    <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{uploadedFileName}</p>
                    <p className="text-xs text-sanctuary-500">
                      {validationResult?.info.totalRecords.toLocaleString()} records
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClearUpload}
                  className="p-2 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-sanctuary-500" />
                </button>
              </div>

              {/* Backup Details */}
              {uploadedBackup.meta && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2 text-sm">
                    <Clock className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      {formatDate(uploadedBackup.meta.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <User className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      {uploadedBackup.meta.createdBy}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <Database className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      v{uploadedBackup.meta.appVersion}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <Layers className="w-4 h-4 text-sanctuary-400" />
                    <span className="text-sanctuary-600 dark:text-sanctuary-400">
                      {validationResult?.info.tables.length} tables
                    </span>
                  </div>
                </div>
              )}

              {uploadedBackup.meta?.description && (
                <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 italic">
                  "{uploadedBackup.meta.description}"
                </p>
              )}

              {/* Validation Status */}
              {isValidating ? (
                <div className="flex items-center space-x-2 p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
                  <span className="animate-spin">⏳</span>
                  <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">Validating backup...</span>
                </div>
              ) : validationResult && (
                <div className="space-y-2">
                  {validationResult.valid ? (
                    <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
                      <Check className="w-4 h-4" />
                      <span className="text-sm">Backup is valid and ready to restore</span>
                    </div>
                  ) : (
                    <div className="flex items-start space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                      <AlertCircle className="w-4 h-4 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium">Backup validation failed:</p>
                        <ul className="list-disc list-inside mt-1">
                          {validationResult.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {validationResult.warnings.length > 0 && (
                    <div className="flex items-start space-x-2 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400">
                      <AlertTriangle className="w-4 h-4 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium">Warnings:</p>
                        <ul className="list-disc list-inside mt-1">
                          {validationResult.warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Restore Button */}
              <Button
                onClick={() => setShowConfirmModal(true)}
                disabled={!validationResult?.valid || isRestoring}
                variant="danger"
                className="w-full"
              >
                {isRestoring ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    Restoring...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Restore from Backup
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Success/Error Messages */}
          {restoreSuccess && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">Database restored successfully! Reloading...</span>
            </div>
          )}

          {restoreError && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{restoreError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="surface-secondary rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          About Backups
        </h4>
        <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-1">
          <li>• Backups include all users, wallets, transactions, addresses, labels, and settings</li>
          <li>• Backups from older versions can be restored to newer versions</li>
          <li>• Passwords are stored as secure hashes and remain protected</li>
          <li>• Consider creating regular backups before major changes</li>
        </ul>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 w-full max-w-md mx-4 overflow-hidden">
            <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Confirm Database Restore
                </h3>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
                This action will:
              </p>
              <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 list-disc list-inside space-y-1">
                <li><strong className="text-red-600 dark:text-red-400">Delete ALL current data</strong></li>
                <li>Replace with backup from {uploadedBackup?.meta && formatDate(uploadedBackup.meta.createdAt)}</li>
                <li>Log you out (you'll need to log in again)</li>
              </ul>

              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mt-4">
                Type <span className="font-mono bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-0.5 rounded">RESTORE</span> to confirm:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder="Type RESTORE"
                className="w-full px-3 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                autoFocus
              />

              <div className="flex space-x-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowConfirmModal(false);
                    setConfirmText('');
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleRestore}
                  disabled={confirmText !== 'RESTORE'}
                  className="flex-1"
                >
                  Confirm Restore
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
