/**
 * AI Settings Administration Page
 *
 * Manage AI-powered features in an isolated security context.
 * This page configures the separate AI container that handles all AI operations.
 */

import React, { useState, useEffect } from 'react';
import { Brain, Check, AlertCircle, Loader2, Shield, Server, ExternalLink, Search, Download, ChevronDown, RefreshCw } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import * as aiApi from '../src/api/ai';
import { createLogger } from '../utils/logger';

const log = createLogger('AISettings');

// Popular models for quick pull
const POPULAR_MODELS = [
  { name: 'llama3.2:3b', description: 'Meta, fast & lightweight (2GB)', recommended: true },
  { name: 'deepseek-r1:7b', description: 'DeepSeek, reasoning model (4.7GB)' },
  { name: 'deepseek-r1:1.5b', description: 'DeepSeek, compact (1GB)' },
  { name: 'mistral:7b', description: 'Mistral AI, balanced (4GB)' },
  { name: 'qwen2.5:7b', description: 'Alibaba, multilingual (4.7GB)' },
  { name: 'gemma2:2b', description: 'Google, compact (1.6GB)' },
  { name: 'phi3:mini', description: 'Microsoft, small (2.3GB)' },
  { name: 'llama3.2:1b', description: 'Meta, ultra-fast (1GB)' },
];

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

  // Detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState('');

  // Models state
  const [availableModels, setAvailableModels] = useState<aiApi.OllamaModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Pull model state
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState('');
  const [pullModelName, setPullModelName] = useState('');
  const [customModelName, setCustomModelName] = useState('');

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

  // Load models when endpoint changes
  useEffect(() => {
    if (aiEndpoint && aiEnabled) {
      loadModels();
    }
  }, [aiEndpoint, aiEnabled]);

  const loadModels = async () => {
    if (!aiEndpoint) return;

    setIsLoadingModels(true);
    try {
      const result = await aiApi.listModels();
      setAvailableModels(result.models || []);
    } catch (error) {
      log.error('Failed to load models', { error });
    } finally {
      setIsLoadingModels(false);
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
      // Reload models after saving
      loadModels();
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

  const handleDetectOllama = async () => {
    setIsDetecting(true);
    setDetectMessage('Searching for Ollama...');

    try {
      const result = await aiApi.detectOllama();
      if (result.found && result.endpoint) {
        setAiEndpoint(result.endpoint);
        setDetectMessage(`Found Ollama at ${result.endpoint}`);
        // If models were detected, show them
        if (result.models && result.models.length > 0) {
          setDetectMessage(`Found Ollama with ${result.models.length} model(s)`);
          // Auto-select first model if none selected
          if (!aiModel && result.models.length > 0) {
            setAiModel(result.models[0]);
          }
        }
        // Reload models list
        setTimeout(loadModels, 500);
      } else {
        setDetectMessage(result.message || 'Ollama not found. Is it running?');
      }
    } catch (error) {
      log.error('Ollama detection failed', { error });
      setDetectMessage('Detection failed. Check AI container logs.');
    } finally {
      setIsDetecting(false);
      setTimeout(() => setDetectMessage(''), 5000);
    }
  };

  const handleSelectModel = (modelName: string) => {
    setAiModel(modelName);
    setShowModelDropdown(false);
  };

  const handlePullModel = async (model: string) => {
    setIsPulling(true);
    setPullModelName(model);
    setPullProgress('Starting download...');

    try {
      const result = await aiApi.pullModel(model);
      if (result.success) {
        setPullProgress(`Successfully pulled ${model}`);
        // Reload models list
        await loadModels();
        // Auto-select the pulled model
        setAiModel(model);
      } else {
        setPullProgress(`Failed: ${result.error}`);
      }
    } catch (error: any) {
      log.error('Pull model failed', { error });
      setPullProgress(`Error: ${error.message || 'Pull failed'}`);
    } finally {
      setIsPulling(false);
      setTimeout(() => {
        setPullProgress('');
        setPullModelName('');
      }, 5000);
    }
  };

  const formatModelSize = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
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
                  Requires Ollama or another AI backend running on your host.
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
            {/* Endpoint URL with Detect Button */}
            <div>
              <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                AI Endpoint URL
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={aiEndpoint}
                  onChange={(e) => setAiEndpoint(e.target.value)}
                  placeholder="http://host.docker.internal:11434"
                  className="flex-1 px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button
                  onClick={handleDetectOllama}
                  disabled={isDetecting}
                  className="px-4 py-2 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                >
                  {isDetecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  <span>Detect</span>
                </button>
              </div>
              {detectMessage && (
                <p className={`text-xs mt-1 ${detectMessage.includes('Found') ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-500'}`}>
                  {detectMessage}
                </p>
              )}
              <p className="text-xs text-sanctuary-500 mt-1">
                Click "Detect" to auto-find Ollama, or enter URL manually
              </p>
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                Model
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="w-full px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 flex items-center justify-between"
                >
                  <span className={aiModel ? '' : 'text-sanctuary-400'}>
                    {aiModel || 'Select a model...'}
                  </span>
                  <div className="flex items-center space-x-2">
                    {isLoadingModels && <Loader2 className="w-4 h-4 animate-spin text-sanctuary-400" />}
                    <ChevronDown className="w-4 h-4 text-sanctuary-400" />
                  </div>
                </button>

                {showModelDropdown && (
                  <div className="absolute z-10 w-full mt-1 surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg max-h-60 overflow-y-auto">
                    {/* Available models from Ollama */}
                    {availableModels.length > 0 && (
                      <>
                        <div className="px-3 py-2 text-xs font-medium text-sanctuary-500 uppercase border-b border-sanctuary-100 dark:border-sanctuary-800">
                          Installed Models
                        </div>
                        {availableModels.map((model) => (
                          <button
                            key={model.name}
                            onClick={() => handleSelectModel(model.name)}
                            className={`w-full px-3 py-2 text-left hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors flex items-center justify-between ${
                              aiModel === model.name ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                            }`}
                          >
                            <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{model.name}</span>
                            <span className="text-xs text-sanctuary-400">{formatModelSize(model.size)}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {/* Manual input option */}
                    <div className="px-3 py-2 border-t border-sanctuary-100 dark:border-sanctuary-800">
                      <input
                        type="text"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder="Or type model name..."
                        className="w-full px-2 py-1 text-sm rounded border border-sanctuary-200 dark:border-sanctuary-700 bg-sanctuary-50 dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-sanctuary-500">
                  Select from installed models or type a model name
                </p>
                {aiEndpoint && (
                  <button
                    onClick={loadModels}
                    disabled={isLoadingModels}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                )}
              </div>
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

      {/* Download Models Section */}
      {aiEnabled && aiEndpoint && (
        <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
          <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center space-x-3">
              <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
                <Download className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Download Models
              </h2>
            </div>
          </div>

          <div className="p-6">
            <p className="text-sm text-sanctuary-500 mb-4">
              Download popular models directly from Ollama. Models are stored on your host machine.
            </p>

            {/* Pull progress */}
            {pullProgress && (
              <div className={`mb-4 p-3 rounded-lg ${
                pullProgress.includes('Successfully')
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : pullProgress.includes('Failed') || pullProgress.includes('Error')
                    ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                    : 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
              }`}>
                <div className="flex items-center space-x-2">
                  {isPulling && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span className="text-sm">{pullProgress}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {POPULAR_MODELS.map((model) => {
                const isInstalled = availableModels.some(m => m.name === model.name);
                const isPullingThis = isPulling && pullModelName === model.name;

                return (
                  <div
                    key={model.name}
                    className={`p-3 rounded-lg border ${
                      isInstalled
                        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                        : 'border-sanctuary-200 dark:border-sanctuary-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                            {model.name}
                          </span>
                          {model.recommended && (
                            <span className="px-1.5 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-sanctuary-500 mt-0.5">{model.description}</p>
                      </div>
                      {isInstalled ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center">
                          <Check className="w-3 h-3 mr-1" />
                          Installed
                        </span>
                      ) : (
                        <button
                          onClick={() => handlePullModel(model.name)}
                          disabled={isPulling}
                          className="px-3 py-1 text-xs bg-primary-600 hover:bg-primary-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-1"
                        >
                          {isPullingThis ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          <span>Pull</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom Model Input */}
            <div className="mt-4 pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
              <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                Pull Any Model
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={customModelName}
                  onChange={(e) => setCustomModelName(e.target.value)}
                  placeholder="e.g., codellama:13b, mixtral:8x7b, deepseek-coder:6.7b"
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 placeholder:text-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  disabled={isPulling}
                />
                <button
                  onClick={() => {
                    if (customModelName.trim()) {
                      handlePullModel(customModelName.trim());
                      setCustomModelName('');
                    }
                  }}
                  disabled={isPulling || !customModelName.trim()}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                >
                  {isPulling && pullModelName === customModelName.trim() ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>Pull</span>
                </button>
              </div>
              <p className="text-xs text-sanctuary-500 mt-1">
                Browse all models at <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">ollama.com/library</a>
              </p>
            </div>

            <p className="text-xs text-sanctuary-400 mt-4">
              First download may take several minutes depending on model size and your internet speed.
            </p>
          </div>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Quick Setup
          </h2>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              1. Install Ollama
            </h3>
            <div className="p-3 rounded-lg bg-sanctuary-900 dark:bg-sanctuary-950 font-mono text-sm text-sanctuary-100 overflow-x-auto">
              <div># Visit ollama.ai to download, then run:</div>
              <div>ollama serve</div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              2. Enable AI & Detect
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Enable AI Features above, then click "Detect" to auto-configure the endpoint.
              Download a model using the "Pull" button.
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
