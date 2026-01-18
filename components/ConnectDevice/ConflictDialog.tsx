/**
 * ConflictDialog Component
 *
 * Modal dialog for handling device conflicts when a device with the same
 * fingerprint already exists. Shows comparison and merge options.
 */

import React from 'react';
import { AlertTriangle, Check, GitMerge, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { getDeviceIcon } from '../ui/CustomIcons';
import { ConflictDialogProps } from './types';

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  conflictData,
  merging,
  error,
  onMerge,
  onViewExisting,
  onCancel,
}) => {
  const hasConflictingAccounts = conflictData.comparison.conflictingAccounts.length > 0;
  const hasNewAccounts = conflictData.comparison.newAccounts.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-50">
                Device Already Exists
              </h3>
              <p className="text-sm text-sanctuary-500 mt-1">
                A device with fingerprint <span className="font-mono">{conflictData.existingDevice.fingerprint}</span> is already registered.
              </p>
            </div>
          </div>

          {/* Existing Device Info */}
          <div className="p-3 rounded-xl bg-sanctuary-100 dark:bg-sanctuary-800 border border-sanctuary-200 dark:border-sanctuary-700 mb-4">
            <div className="flex items-center gap-2 mb-2">
              {getDeviceIcon(conflictData.existingDevice.type, "w-5 h-5")}
              <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {conflictData.existingDevice.label}
              </span>
            </div>
            <div className="text-xs text-sanctuary-500">
              {conflictData.existingDevice.accounts.length} account{conflictData.existingDevice.accounts.length !== 1 ? 's' : ''} registered
            </div>
          </div>

          {/* Comparison Summary */}
          <div className="space-y-3 mb-6">
            {/* New Accounts */}
            {hasNewAccounts && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    {conflictData.comparison.newAccounts.length} New Account{conflictData.comparison.newAccounts.length !== 1 ? 's' : ''} Can Be Added
                  </span>
                </div>
                <div className="space-y-1 ml-6">
                  {conflictData.comparison.newAccounts.map((account, idx) => (
                    <div key={idx} className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
                      {account.derivationPath}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Matching Accounts */}
            {conflictData.comparison.matchingAccounts.length > 0 && (
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    {conflictData.comparison.matchingAccounts.length} Account{conflictData.comparison.matchingAccounts.length !== 1 ? 's' : ''} Already Exist
                  </span>
                </div>
                <div className="space-y-1 ml-6">
                  {conflictData.comparison.matchingAccounts.map((account, idx) => (
                    <div key={idx} className="text-xs text-blue-600 dark:text-blue-400 font-mono">
                      {account.derivationPath}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conflicting Accounts (security warning) */}
            {hasConflictingAccounts && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span className="text-sm font-medium text-rose-700 dark:text-rose-300">
                    {conflictData.comparison.conflictingAccounts.length} Conflicting Account{conflictData.comparison.conflictingAccounts.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-xs text-rose-600 dark:text-rose-400 mb-2 ml-6">
                  These paths have different xpubs than what's already registered. This could indicate a security issue.
                </p>
                <div className="space-y-1 ml-6">
                  {conflictData.comparison.conflictingAccounts.map((conflict, idx) => (
                    <div key={idx} className="text-xs font-mono">
                      <span className="text-rose-600 dark:text-rose-400">{conflict.incoming.derivationPath}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {/* Merge button - only show if there are new accounts to add */}
            {hasNewAccounts && (
              <Button
                onClick={onMerge}
                disabled={merging || hasConflictingAccounts}
                className="w-full"
              >
                {merging ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Merging...
                  </>
                ) : (
                  <>
                    <GitMerge className="w-4 h-4 mr-2" />
                    Merge {conflictData.comparison.newAccounts.length} New Account{conflictData.comparison.newAccounts.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            )}

            {/* View existing device */}
            <button
              onClick={onViewExisting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 text-sm font-medium hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View Existing Device
            </button>

            {/* Cancel */}
            <button
              onClick={onCancel}
              className="w-full px-4 py-2 text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
            >
              Cancel
            </button>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-3">
              {error}
            </p>
          )}

          {/* Warning about conflicting accounts */}
          {hasConflictingAccounts && (
            <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-3">
              Cannot merge while there are conflicting accounts. Please resolve the conflicts first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
