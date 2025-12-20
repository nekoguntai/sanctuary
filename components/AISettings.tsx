/**
 * AI Settings Administration Page
 *
 * Manage AI-powered features in an isolated security context.
 * This page configures the separate AI container that handles all AI operations.
 */

import React, { useState, useEffect } from 'react';
import { Brain, Check, AlertCircle, Loader2, Shield, Server, ExternalLink } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import * as aiApi from '../src/api/ai';
import { createLogger } from '../utils/logger';

const log = createLogger('AISettings');

export default function AISettings() {
  // AI settings state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState('');
  const [aiModel, setAiModel] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // AI status
  const [aiStatus, setAiStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [aiStatusMessage, setAiStatusMessage] = useState('');

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await adminApi.getSystemSettings();
        setAiEnabled(settings.aiEnabled || false);
        setAiEndpoint(settings.aiEndpoint || '');
        setAiModel(settings.aiModel || '');
      } catch (error) {
        log.error('Failed to load AI settings', { error });
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

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
    } catch (error) {
      log.error('Failed to toggle AI', { error });
      setSaveError('Failed to update AI settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveConfig = async () => {
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
      log.error('Failed to save AI configuration', { error });
      setSaveError('Failed to save AI configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setAiStatus('checking');
    setAiStatusMessage('Testing connection...');

    try {
      const status = await aiApi.getAIStatus();
      if (status.available) {
        setAiStatus('connected');
        setAiStatusMessage(`Connected to ${status.model || 'AI model'}`);
      } else {
        setAiStatus('error');
        setAiStatusMessage(status.error || status.message || 'AI not available');
      }
    } catch (error) {
      log.error('Failed to test AI connection', { error });
      setAiStatus('error');
      setAiStatusMessage('Failed to connect');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            AI Assistant
          </h1>
          <p className="text-sm text-sanctuary-500 mt-1">
            Configure AI-powered transaction labeling and natural language queries
          </p>
        </div>
        <div className="p-3 surface-secondary rounded-xl">
          <Brain className="w-8 h-8 text-primary-600 dark:text-primary-400" />
        </div>
      </div>

      {/* Security Notice */}
      <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-start space-x-3">
          <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              Isolated AI Architecture
            </h3>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
              AI runs in a separate container with no access to private keys, signing operations, or the database.
              Only sanitized transaction metadata (amounts, dates) is shared with AI. Addresses and transaction IDs are never exposed.
            </p>
          </div>
        </div>
      </div>

      {/* Enable/Disable Toggle */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <Brain className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
              AI Features
            </h2>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-start space-x-4">
              <div className="space-y-1">
                <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Enable AI Features
                </label>
                <p className="text-sm text-sanctuary-500 max-w-md">
                  Enable AI-powered transaction labeling and natural language queries.
                  Requires the AI container to be running and a configured AI endpoint.
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
        </div>
      </div>

      {/* AI Configuration */}
      {aiEnabled && (
        <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
          <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center space-x-3">
              <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
                <Server className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                AI Endpoint Configuration
              </h2>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Endpoint URL */}
            <div>
              <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                AI Endpoint URL
              </label>
              <input
                type="text"
                value={aiEndpoint}
                onChange={(e) => setAiEndpoint(e.target.value)}
                placeholder="http://host.docker.internal:11434"
                className="w-full px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-sanctuary-500 mt-1">
                OpenAI-compatible API endpoint (Ollama, llama.cpp, LM Studio, etc.)
              </p>
            </div>

            {/* Model Name */}
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
                Model name as configured in your AI endpoint
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-3">
              <button
                onClick={handleSaveConfig}
                disabled={isSaving || !aiEndpoint || !aiModel}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save Configuration'}
              </button>

              <button
                onClick={handleTestConnection}
                disabled={aiStatus === 'checking' || !aiEndpoint || !aiModel}
                className="px-4 py-2 border border-sanctuary-300 dark:border-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {aiStatus === 'checking' ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {/* Status Messages */}
            {saveSuccess && (
              <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
                <Check className="w-4 h-4" />
                <span className="text-sm">Configuration saved</span>
              </div>
            )}

            {saveError && (
              <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{saveError}</span>
              </div>
            )}

            {aiStatusMessage && (
              <div className={`flex items-center space-x-2 ${
                aiStatus === 'connected'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : aiStatus === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-sanctuary-500'
              }`}>
                {aiStatus === 'connected' && <Check className="w-4 h-4" />}
                {aiStatus === 'error' && <AlertCircle className="w-4 h-4" />}
                {aiStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
                <span className="text-sm">{aiStatusMessage}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Setup Instructions
          </h2>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              1. Start the AI Container
            </h3>
            <div className="p-3 rounded-lg bg-sanctuary-900 dark:bg-sanctuary-950 font-mono text-sm text-sanctuary-100 overflow-x-auto">
              docker compose --profile ai up -d
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              2. Run a Local AI (Recommended: Ollama)
            </h3>
            <div className="p-3 rounded-lg bg-sanctuary-900 dark:bg-sanctuary-950 font-mono text-sm text-sanctuary-100 overflow-x-auto space-y-1">
              <div># Install Ollama from ollama.ai</div>
              <div>ollama serve</div>
              <div>ollama pull llama3.2:3b</div>
            </div>
            <p className="text-xs text-sanctuary-500">
              Use endpoint: <code className="px-1 py-0.5 rounded bg-sanctuary-100 dark:bg-sanctuary-800">http://host.docker.internal:11434</code>
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              3. Network Isolation (Default: Local Only)
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              By default, the AI container cannot access the internet. This ensures your transaction data
              never leaves your network. To use cloud AI providers, you must explicitly modify the
              docker-compose.yml to remove network isolation.
            </p>
          </div>

          <a
            href="https://github.com/n-narusegawa/sanctuary/blob/main/ai-proxy/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1 text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            <span>View full documentation</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Features */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            AI Features
          </h2>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl surface-secondary">
              <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                Transaction Labeling
              </h3>
              <p className="text-xs text-sanctuary-500">
                AI suggests labels for your transactions based on amount, direction, and your existing labeling patterns.
                You always review and confirm before applying.
              </p>
            </div>

            <div className="p-4 rounded-xl surface-secondary">
              <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                Natural Language Queries
              </h3>
              <p className="text-xs text-sanctuary-500">
                Ask questions like "Show my largest receives this month" and get filtered results.
                AI converts your question to a structured query.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
