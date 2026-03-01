/**
 * Backup & Restore Component
 *
 * Admin-only page for creating database backups and restoring from backup files.
 * Accessible from Administration > Backup & Restore in the sidebar.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/Button';
import {
  Download,
  Upload,
  AlertTriangle,
  Check,
  Key,
  Copy,
  FileText,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type { SanctuaryBackup, ValidationResult, EncryptionKeysResponse } from '../../src/api/admin';
import { createLogger } from '../../utils/logger';
import { useAppNotifications } from '../../contexts/AppNotificationContext';
import { downloadText, downloadBlob } from '../../utils/download';
import { BackupPanel } from './BackupPanel';
import { RestorePanel } from './RestorePanel';
import { EncryptionKeyDisplay } from './EncryptionKeyDisplay';

const log = createLogger('BackupRestore');

// Local storage key for "don't show again" preference
const BACKUP_MODAL_DISMISSED_KEY = 'sanctuary_backup_modal_dismissed';

type BackupTab = 'backup' | 'restore';

export const BackupRestore: React.FC = () => {
  const { addNotification } = useAppNotifications();
  const [activeTab, setActiveTab] = useState<BackupTab>('backup');

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

  // Encryption keys state
  const [encryptionKeys, setEncryptionKeys] = useState<EncryptionKeysResponse | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);
  const [showEncryptionSalt, setShowEncryptionSalt] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Post-backup modal state
  const [showBackupCompleteModal, setShowBackupCompleteModal] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch encryption keys on mount
  useEffect(() => {
    const fetchEncryptionKeys = async () => {
      try {
        const keys = await adminApi.getEncryptionKeys();
        setEncryptionKeys(keys);
      } catch (error) {
        log.error('Failed to fetch encryption keys', { error });
      } finally {
        setIsLoadingKeys(false);
      }
    };
    fetchEncryptionKeys();
  }, []);

  /**
   * Copy text to clipboard
   */
  const copyToClipboard = async (text: string, keyName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyName);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      log.error('Failed to copy to clipboard', { error });
    }
  };

  /**
   * Download encryption keys as a text file
   */
  const downloadEncryptionKeys = () => {
    if (!encryptionKeys) return;

    const content = `# Sanctuary Encryption Keys
# Generated: ${new Date().toISOString()}
#
# IMPORTANT: Keep this file secure! These keys are required to restore
# encrypted data (node passwords, 2FA secrets) on a new Sanctuary instance.
#
# To use these keys on a new instance:
# 1. Add these lines to your .env file BEFORE restoring from backup
# 2. Restart Sanctuary
# 3. Then restore your backup
#

ENCRYPTION_KEY=${encryptionKeys.encryptionKey}
ENCRYPTION_SALT=${encryptionKeys.encryptionSalt}
`;

    const filename = `sanctuary-encryption-keys-${new Date().toISOString().slice(0, 10)}.txt`;
    downloadText(content, filename);
  };

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
      const timestamp = new Date().toISOString()
        .slice(0, 19)
        .replace(/[T:]/g, '-');
      const filename = `sanctuary-backup-${timestamp}.json`;
      downloadBlob(blob, filename);

      setBackupSuccess(true);
      setDescription('');

      // Show backup complete modal if not dismissed
      const isDismissed = localStorage.getItem(BACKUP_MODAL_DISMISSED_KEY) === 'true';
      if (!isDismissed) {
        setShowBackupCompleteModal(true);
      }

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
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Backup & Restore</h2>
        <p className="text-sanctuary-500">Create database backups and restore from backup files</p>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 surface-secondary rounded-xl p-1">
        <button
          onClick={() => setActiveTab('backup')}
          className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
            activeTab === 'backup'
              ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
              : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Backup</span>
        </button>
        <button
          onClick={() => setActiveTab('restore')}
          className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
            activeTab === 'restore'
              ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
              : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Restore</span>
        </button>
      </div>

      {/* Create Backup Section */}
      {activeTab === 'backup' && (
        <BackupPanel
          isCreatingBackup={isCreatingBackup}
          includeCache={includeCache}
          setIncludeCache={setIncludeCache}
          description={description}
          setDescription={setDescription}
          handleCreateBackup={handleCreateBackup}
          backupSuccess={backupSuccess}
          backupError={backupError}
        />
      )}

      {/* Restore Section */}
      {activeTab === 'restore' && (
        <RestorePanel
          uploadedBackup={uploadedBackup}
          uploadedFileName={uploadedFileName}
          validationResult={validationResult}
          isValidating={isValidating}
          isRestoring={isRestoring}
          restoreError={restoreError}
          restoreSuccess={restoreSuccess}
          showConfirmModal={showConfirmModal}
          confirmText={confirmText}
          fileInputRef={fileInputRef}
          setShowConfirmModal={setShowConfirmModal}
          setConfirmText={setConfirmText}
          handleFileUpload={handleFileUpload}
          handleClearUpload={handleClearUpload}
          handleRestore={handleRestore}
          formatDate={formatDate}
        />
      )}

      {/* Encryption Keys Section */}
      <EncryptionKeyDisplay
        encryptionKeys={encryptionKeys}
        isLoadingKeys={isLoadingKeys}
        showEncryptionKey={showEncryptionKey}
        setShowEncryptionKey={setShowEncryptionKey}
        showEncryptionSalt={showEncryptionSalt}
        setShowEncryptionSalt={setShowEncryptionSalt}
        copiedKey={copiedKey}
        copyToClipboard={copyToClipboard}
        downloadEncryptionKeys={downloadEncryptionKeys}
      />

      {/* Info Box */}
      <div className="surface-secondary rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          {activeTab === 'backup' ? 'About Backups' : 'About Restore'}
        </h4>
        <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-1">
          {activeTab === 'backup' ? (
            <>
              <li>• Backups include all users, wallets, transactions, addresses, labels, and settings</li>
              <li>• Backups can be restored to this or another Sanctuary instance</li>
              <li>• Passwords are stored as secure hashes and remain protected</li>
              <li>• Consider creating regular backups before major changes</li>
              <li>• <strong>Node passwords and 2FA secrets are encrypted</strong> - save your encryption keys!</li>
            </>
          ) : (
            <>
              <li>• Restoring will completely replace all existing data</li>
              <li>• Backups from older versions can be restored to newer versions</li>
              <li>• You will be logged out after restore and need to log in again</li>
              <li>• The restore process cannot be undone - create a backup first</li>
              <li>• <strong>To restore encrypted data</strong>, ensure ENCRYPTION_KEY and ENCRYPTION_SALT match the original instance</li>
            </>
          )}
        </ul>
      </div>

      {/* Backup Complete Modal - Encryption Key Reminder */}
      {showBackupCompleteModal && encryptionKeys && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 w-full max-w-lg mx-4 overflow-hidden">
            <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-warning-50 dark:bg-warning-900/20">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-warning-100 dark:bg-warning-800/50 rounded-lg">
                  <Key className="w-5 h-5 text-warning-600 dark:text-warning-400" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Backup Downloaded Successfully
                  </h3>
                  <p className="text-sm text-sanctuary-500">Don't forget your encryption keys!</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-start space-x-3 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
                <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-warning-700 dark:text-warning-300">
                  <strong>To restore this backup on a new instance, you'll need these encryption keys.</strong>
                  <p className="mt-1">Without them, node passwords and 2FA settings cannot be restored.</p>
                </div>
              </div>

              {/* Keys Display */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400">
                    ENCRYPTION_KEY
                  </label>
                  <div className="font-mono text-xs bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg px-3 py-2 text-sanctuary-900 dark:text-sanctuary-100 break-all">
                    {encryptionKeys.encryptionKey}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400">
                    ENCRYPTION_SALT
                  </label>
                  <div className="font-mono text-xs bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg px-3 py-2 text-sanctuary-900 dark:text-sanctuary-100 break-all">
                    {encryptionKeys.encryptionSalt}
                  </div>
                </div>

                <div className="flex space-x-2">
                  <Button
                    variant="secondary"
                    onClick={() => copyToClipboard(
                      `ENCRYPTION_KEY=${encryptionKeys.encryptionKey}\nENCRYPTION_SALT=${encryptionKeys.encryptionSalt}`,
                      'modal-both'
                    )}
                    className="flex-1"
                  >
                    {copiedKey === 'modal-both' ? (
                      <>
                        <Check className="w-4 h-4 mr-2 text-success-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Both
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={downloadEncryptionKeys}
                    className="flex-1"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Download .txt
                  </Button>
                </div>
              </div>

              {/* Don't show again checkbox */}
              <label className="flex items-center space-x-2 text-sm text-sanctuary-600 dark:text-sanctuary-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                  className="rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500"
                />
                <span>Don't show this reminder again</span>
              </label>

              <Button
                onClick={() => {
                  if (dontShowAgain) {
                    localStorage.setItem(BACKUP_MODAL_DISMISSED_KEY, 'true');
                  }
                  setShowBackupCompleteModal(false);
                  setDontShowAgain(false);
                }}
                className="w-full"
              >
                <Check className="w-4 h-4 mr-2" />
                I've Saved My Keys
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
