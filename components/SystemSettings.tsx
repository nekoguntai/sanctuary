import React, { useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { Shield, UserPlus, Check, AlertCircle, Brain, Loader2 } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import * as aiApi from '../src/api/ai';
import { createLogger } from '../utils/logger';

const log = createLogger('SystemSettings');

export const SystemSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // AI settings state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiStatus, setAiStatus] = useState<'unknown' | 'checking' | 'available' | 'unavailable'>('unknown');
  const [aiStatusMessage, setAiStatusMessage] = useState('');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await adminApi.getSystemSettings();
        setRegistrationEnabled(settings.registrationEnabled);
        setAiEnabled(settings.aiEnabled || false);
        setAiEndpoint(settings.aiEndpoint || '');
        setAiModel(settings.aiModel || '');
      } catch (error) {
        log.error('Failed to load settings', { error });
        // Default to disabled on error (admin-only)
        setRegistrationEnabled(false);
        setAiEnabled(false);
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

  const handleToggleAI = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const newValue = !aiEnabled;

    try {
      await adminApi.updateSystemSettings({ aiEnabled: newValue });
      setAiEnabled(newValue);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      // Reset status when disabling
      if (!newValue) {
        setAiStatus('unknown');
        setAiStatusMessage('');
      }
    } catch (error) {
      log.error('Failed to update AI settings', { error });
      setSaveError('Failed to update AI settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAIConfig = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await adminApi.updateSystemSettings({
        aiEndpoint,
        aiModel,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      log.error('Failed to update AI configuration', { error });
      setSaveError('Failed to update AI configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckAIStatus = async () => {
    setAiStatus('checking');
    setAiStatusMessage('Checking AI endpoint...');

    try {
      const status = await aiApi.getAIStatus();

      if (status.available) {
        setAiStatus('available');
        setAiStatusMessage(`Connected to ${status.model || 'AI model'}`);
      } else {
        setAiStatus('unavailable');
        setAiStatusMessage(status.error || status.message || 'AI endpoint not available');
      }
    } catch (error) {
      log.error('Failed to check AI status', { error });
      setAiStatus('unavailable');
      setAiStatusMessage('Failed to connect to AI endpoint');
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

      {/* AI Settings */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <Brain className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">AI Assistant</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* AI Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-start space-x-4">
              <div className="p-2 surface-secondary rounded-lg">
                <Brain className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
              </div>
              <div className="space-y-1">
                <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Enable AI Features
                </label>
                <p className="text-sm text-sanctuary-500 max-w-md">
                  Enable AI-powered transaction labeling and natural language queries. Requires a configured AI endpoint.
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleAI}
              disabled={isSaving}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                aiEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
              } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  aiEnabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* AI Configuration (shown when enabled) */}
          {aiEnabled && (
            <>
              <div className="space-y-4 pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
                <div>
                  <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                    AI Endpoint URL
                  </label>
                  <input
                    type="text"
                    value={aiEndpoint}
                    onChange={(e) => setAiEndpoint(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                    className="w-full px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-sanctuary-500 mt-1">
                    OpenAI-compatible API endpoint (Ollama, llama.cpp, LM Studio, etc.)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                    Model Name
                  </label>
                  <input
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="llama3.2:3b"
                    className="w-full px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-sanctuary-500 mt-1">
                    Name of the model to use for AI requests
                  </p>
                </div>

                <div className="flex space-x-3">
                  <Button
                    onClick={handleSaveAIConfig}
                    disabled={isSaving || !aiEndpoint || !aiModel}
                    variant="primary"
                  >
                    Save Configuration
                  </Button>
                  <Button
                    onClick={handleCheckAIStatus}
                    disabled={aiStatus === 'checking' || !aiEndpoint || !aiModel}
                    variant="outline"
                  >
                    {aiStatus === 'checking' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                </div>

                {/* AI Status */}
                {aiStatus !== 'unknown' && aiStatus !== 'checking' && (
                  <div className={`flex items-center space-x-2 p-3 rounded-lg ${
                    aiStatus === 'available'
                      ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  }`}>
                    {aiStatus === 'available' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    <span className="text-sm">{aiStatusMessage}</span>
                  </div>
                )}
              </div>
            </>
          )}

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

      {/* AI Info Box */}
      <div className="surface-secondary rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          About AI Features
        </h4>
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          AI features are optional and read-only. The AI can suggest transaction labels and answer natural language queries,
          but it cannot modify wallet data or access private keys. You must provide your own AI inference endpoint
          (e.g., Ollama running locally). Examples: http://localhost:11434/v1 (Ollama), http://localhost:8080/v1 (llama.cpp)
        </p>
      </div>
    </div>
  );
};
