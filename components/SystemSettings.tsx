import React, { useState, useEffect } from 'react';
import { Shield, UserPlus, Check, AlertCircle } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { createLogger } from '../utils/logger';

const log = createLogger('SystemSettings');

export const SystemSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await adminApi.getSystemSettings();
        setRegistrationEnabled(settings.registrationEnabled);
      } catch (error) {
        log.error('Failed to load settings', { error });
        // Default to disabled on error (admin-only)
        setRegistrationEnabled(false);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleToggleRegistration = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const newValue = !registrationEnabled;

    try {
      await adminApi.updateSystemSettings({ registrationEnabled: newValue });
      setRegistrationEnabled(newValue);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      log.error('Failed to update settings', { error });
      setSaveError('Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading system settings...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">System Settings</h2>
        <p className="text-sanctuary-500">Configure system-wide settings for Sanctuary</p>
      </div>

      {/* Registration Settings */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Access Control</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Public Registration Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-start space-x-4">
              <div className="p-2 surface-secondary rounded-lg">
                <UserPlus className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
              </div>
              <div className="space-y-1">
                <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Public Registration
                </label>
                <p className="text-sm text-sanctuary-500 max-w-md">
                  Allow new users to create accounts on their own. When disabled, only administrators can create new user accounts.
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleRegistration}
              disabled={isSaving}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                registrationEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
              } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  registrationEnabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Status Message */}
          <div className={`flex items-center space-x-2 p-3 rounded-lg ${
            registrationEnabled
              ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
              : 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400'
          }`}>
            {registrationEnabled ? (
              <>
                <Check className="w-4 h-4" />
                <span className="text-sm">Public registration is enabled. Anyone can create an account.</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">Public registration is disabled. Only admins can create accounts.</span>
              </>
            )}
          </div>

          {/* Save Feedback */}
          {saveSuccess && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">Settings saved successfully</span>
            </div>
          )}

          {saveError && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{saveError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="surface-secondary rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          About User Management
        </h4>
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          When public registration is disabled, you can still create new users from the{' '}
          <span className="font-medium text-primary-600 dark:text-primary-400">Users & Groups</span>{' '}
          administration page. This is useful for private deployments where you want to control who has access.
        </p>
      </div>
    </div>
  );
};
