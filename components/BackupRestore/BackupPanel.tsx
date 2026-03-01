import React from 'react';
import { Button } from '../ui/Button';
import {
  Download,
  Check,
  AlertCircle,
} from 'lucide-react';

interface BackupPanelProps {
  isCreatingBackup: boolean;
  includeCache: boolean;
  setIncludeCache: (include: boolean) => void;
  description: string;
  setDescription: (desc: string) => void;
  handleCreateBackup: () => void;
  backupSuccess: boolean;
  backupError: string | null;
}

export const BackupPanel: React.FC<BackupPanelProps> = ({
  isCreatingBackup,
  includeCache,
  setIncludeCache,
  description,
  setDescription,
  handleCreateBackup,
  backupSuccess,
  backupError,
}) => {
  return (
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
                className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
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
  );
};
