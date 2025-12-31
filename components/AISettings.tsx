/**
 * AI Settings Administration Page
 *
 * Manage AI-powered features in an isolated security context.
 * This page configures the separate AI container that handles all AI operations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Brain, Check, AlertCircle, AlertTriangle, Loader2, Shield, Server, ExternalLink, Search, Download, ChevronDown, RefreshCw, Play, Square, Trash2, X, Cpu, HardDrive, Zap } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import * as aiApi from '../src/api/ai';
import { createLogger } from '../utils/logger';
import { useModelDownloadProgress, ModelDownloadProgress } from '../hooks/useWebSocket';
import { invalidateAIStatusCache } from '../hooks/useAIStatus';

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

type AISettingsTab = 'status' | 'settings' | 'models';

export default function AISettings() {
  // Tab state
  const [activeTab, setActiveTab] = useState<AISettingsTab>('status');

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
  const [downloadProgress, setDownloadProgress] = useState<ModelDownloadProgress | null>(null);

  // Subscribe to model download progress via WebSocket
  const handleDownloadProgress = useCallback((progress: ModelDownloadProgress) => {
    if (progress.model === pullModelName) {
      setDownloadProgress(progress);

      // Update status message
      if (progress.status === 'complete') {
        setPullProgress(`Successfully pulled ${progress.model}`);
        setIsPulling(false);
        loadModels();
        setAiModel(progress.model);
        setTimeout(() => {
          setPullProgress('');
          setPullModelName('');
          setDownloadProgress(null);
        }, 3000);
      } else if (progress.status === 'error') {
        setPullProgress(`Failed: ${progress.error || 'Unknown error'}`);
        setIsPulling(false);
        setTimeout(() => {
          setPullProgress('');
          setPullModelName('');
          setDownloadProgress(null);
        }, 5000);
      }
    }
  }, [pullModelName]);

  useModelDownloadProgress(handleDownloadProgress);

  // Container state
  const [containerStatus, setContainerStatus] = useState<aiApi.OllamaContainerStatus | null>(null);
  const [isStartingContainer, setIsStartingContainer] = useState(false);
  const [containerMessage, setContainerMessage] = useState('');

  // Enable confirmation modal state
  const [showEnableModal, setShowEnableModal] = useState(false);
  const [systemResources, setSystemResources] = useState<aiApi.SystemResources | null>(null);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [acknowledgeInsufficient, setAcknowledgeInsufficient] = useState(false);

  // Load settings and container status on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settings, containerResult] = await Promise.all([
          adminApi.getSystemSettings(),
          aiApi.getOllamaContainerStatus().catch(() => null),
        ]);
        setAiEnabled(settings.aiEnabled || false);
        setAiEndpoint(settings.aiEndpoint || '');
        setAiModel(settings.aiModel || '');
        if (containerResult) {
          setContainerStatus(containerResult);
        }
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

  // Open the enable confirmation modal and fetch system resources
  const handleOpenEnableModal = async () => {
    setShowEnableModal(true);
    setIsLoadingResources(true);
    setAcknowledgeInsufficient(false);
    setSystemResources(null);

    try {
      const resources = await aiApi.getSystemResources();
      setSystemResources(resources);
    } catch (error) {
      log.error('Failed to fetch system resources', { error });
      // Still allow enabling even if resource check fails
      setSystemResources(null);
    } finally {
      setIsLoadingResources(false);
    }
  };

  // Close the modal without enabling
  const handleCloseEnableModal = () => {
    setShowEnableModal(false);
    setSystemResources(null);
    setAcknowledgeInsufficient(false);
  };

  // Called when user clicks the toggle - show modal if enabling, disable directly if disabling
  const handleToggleAI = async () => {
    if (!aiEnabled) {
      // Enabling - show confirmation modal first
      handleOpenEnableModal();
      return;
    }

    // Disabling - proceed directly
    await performToggleAI(false);
  };

  // Actually perform the enable/disable action
  const performToggleAI = async (newValue: boolean) => {
    setShowEnableModal(false);
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setContainerMessage('');

    try {
      // If enabling AI and bundled container is available but not running, start/create it
      if (newValue && containerStatus?.available && !containerStatus?.running) {
        setIsStartingContainer(true);
        setContainerMessage(containerStatus?.exists ? 'Starting AI container...' : 'Creating AI container (this may take a minute)...');

        const startResult = await aiApi.startOllamaContainer();
        if (!startResult.success) {
          setSaveError(`Failed to start AI container: ${startResult.message}`);
          setIsStartingContainer(false);
          setIsSaving(false);
          return;
        }

        // Update container status
        setContainerStatus(prev => prev ? { ...prev, exists: true, running: true, status: 'running' } : prev);
        setContainerMessage('Container started! Waiting for Ollama to be ready...');

        // Wait a bit for Ollama to initialize (longer if we just created it)
        await new Promise(resolve => setTimeout(resolve, containerStatus?.exists ? 3000 : 5000));
        setIsStartingContainer(false);
      }

      // Enable the AI setting
      await adminApi.updateSystemSettings({ aiEnabled: newValue });
      setAiEnabled(newValue);
      invalidateAIStatusCache(); // Refresh AI status across the app

      // If enabling and container is running, auto-detect and configure
      if (newValue && containerStatus?.available && (containerStatus?.running || containerStatus?.exists)) {
        setContainerMessage('Detecting Ollama endpoint...');

        // Small delay then detect
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
          const detectResult = await aiApi.detectOllama();
          if (detectResult.found && detectResult.endpoint) {
            setAiEndpoint(detectResult.endpoint);
            setContainerMessage(`Found Ollama at ${detectResult.endpoint}`);

            // If models are available, select first one
            if (detectResult.models && detectResult.models.length > 0) {
              const firstModel = detectResult.models[0];
              setAiModel(firstModel);

              // Save the configuration automatically
              await adminApi.updateSystemSettings({
                aiEndpoint: detectResult.endpoint,
                aiModel: firstModel,
              });

              setContainerMessage(`Configured with ${firstModel}`);

              // Load models list
              setTimeout(loadModels, 500);
            } else {
              // Endpoint found but no models - save endpoint
              await adminApi.updateSystemSettings({
                aiEndpoint: detectResult.endpoint,
              });
              setContainerMessage('Ollama connected! Go to the Models tab to pull a model.');
            }
          }
        } catch (detectError) {
          log.error('Auto-detect failed', { error: detectError });
          // Non-fatal - user can configure manually
        }
      }

      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setContainerMessage('');
      }, 5000);
    } catch (error) {
      log.error('Failed to toggle AI', { error });
      setSaveError('Failed to update AI settings');
    } finally {
      setIsSaving(false);
      setIsStartingContainer(false);
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

        // Auto-save the endpoint to database
        await adminApi.updateSystemSettings({ aiEndpoint: result.endpoint });

        // If models were detected, show them and auto-select first
        if (result.models && result.models.length > 0) {
          setDetectMessage(`Found Ollama with ${result.models.length} model(s) - saved!`);
          if (!aiModel && result.models.length > 0) {
            const firstModel = result.models[0];
            setAiModel(firstModel);
            await adminApi.updateSystemSettings({ aiModel: firstModel });
          }
        } else {
          setDetectMessage(`Found Ollama at ${result.endpoint} - saved!`);
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
    setDownloadProgress(null);

    try {
      const result = await aiApi.pullModel(model);
      if (!result.success) {
        // Immediate failure (before streaming started)
        setPullProgress(`Failed: ${result.error}`);
        setIsPulling(false);
        setTimeout(() => {
          setPullProgress('');
          setPullModelName('');
        }, 5000);
      }
      // If success, progress will come via WebSocket
      // The handleDownloadProgress callback will handle completion
    } catch (error: any) {
      log.error('Pull model failed', { error });
      setPullProgress(`Error: ${error.message || 'Pull failed'}`);
      setIsPulling(false);
      setTimeout(() => {
        setPullProgress('');
        setPullModelName('');
      }, 5000);
    }
  };

  // Delete model state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteModelName, setDeleteModelName] = useState('');

  const handleDeleteModel = async (model: string) => {
    if (!confirm(`Delete ${model}? This will free up disk space but you'll need to pull it again to use it.`)) {
      return;
    }

    setIsDeleting(true);
    setDeleteModelName(model);

    try {
      const result = await aiApi.deleteModel(model);
      if (result.success) {
        // If we just deleted the currently selected model, clear selection
        if (aiModel === model) {
          setAiModel('');
        }
        // Reload models list
        await loadModels();
      } else {
        alert(`Failed to delete: ${result.error}`);
      }
    } catch (error: any) {
      log.error('Delete model failed', { error });
      alert(`Error: ${error.message || 'Delete failed'}`);
    } finally {
      setIsDeleting(false);
      setDeleteModelName('');
    }
  };

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatModelSize = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  const refreshContainerStatus = async () => {
    try {
      const status = await aiApi.getOllamaContainerStatus();
      setContainerStatus(status);
    } catch (error) {
      log.error('Failed to refresh container status', { error });
    }
  };

  const handleStartContainer = async () => {
    setIsStartingContainer(true);
    setContainerMessage('Starting AI container...');

    try {
      const result = await aiApi.startOllamaContainer();
      if (result.success) {
        setContainerMessage('Container started! Waiting for Ollama to be ready...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await refreshContainerStatus();

        // Auto-detect after starting
        setContainerMessage('Detecting Ollama endpoint...');
        const detectResult = await aiApi.detectOllama();
        if (detectResult.found && detectResult.endpoint) {
          setAiEndpoint(detectResult.endpoint);
          if (detectResult.models && detectResult.models.length > 0) {
            setAiModel(detectResult.models[0]);
            setContainerMessage(`Connected with ${detectResult.models[0]}`);
          } else {
            setContainerMessage('Connected! Go to the Models tab to pull a model.');
          }
          setTimeout(loadModels, 500);
        } else {
          setContainerMessage('Container running. Click Detect to configure.');
        }
      } else {
        setContainerMessage(`Failed: ${result.message}`);
      }
    } catch (error: any) {
      log.error('Failed to start container', { error });
      setContainerMessage(`Error: ${error.message || 'Failed to start'}`);
    } finally {
      setIsStartingContainer(false);
      setTimeout(() => setContainerMessage(''), 8000);
    }
  };

  const handleStopContainer = async () => {
    setContainerMessage('Stopping AI container...');

    try {
      const result = await aiApi.stopOllamaContainer();
      if (result.success) {
        setContainerMessage('Container stopped');
        await refreshContainerStatus();
      } else {
        setContainerMessage(`Failed: ${result.message}`);
      }
    } catch (error: any) {
      log.error('Failed to stop container', { error });
      setContainerMessage(`Error: ${error.message || 'Failed to stop'}`);
    } finally {
      setTimeout(() => setContainerMessage(''), 5000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  // Tab configuration - progressive unlocking
  const tabs: { id: AISettingsTab; label: string; icon: React.ReactNode; enabled: boolean; description: string }[] = [
    { id: 'status', label: 'Status', icon: <Brain className="w-4 h-4" />, enabled: true, description: 'Enable AI' },
    { id: 'settings', label: 'Settings', icon: <Server className="w-4 h-4" />, enabled: aiEnabled, description: 'Configure endpoint' },
    { id: 'models', label: 'Models', icon: <Download className="w-4 h-4" />, enabled: aiEnabled && !!aiEndpoint, description: 'Manage models' },
  ];

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

      {/* Tab Navigation */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="flex border-b border-sanctuary-200 dark:border-sanctuary-700">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              onClick={() => tab.enabled && setActiveTab(tab.id)}
              disabled={!tab.enabled}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-primary-600 dark:text-primary-400 bg-primary-50/50 dark:bg-primary-900/20'
                  : tab.enabled
                    ? 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
                    : 'text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
              }`}
            >
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                activeTab === tab.id
                  ? 'bg-primary-600 text-white'
                  : tab.enabled
                    ? 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300'
                    : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 dark:text-sanctuary-600'
              }`}>
                {index + 1}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Status Tab */}
          {activeTab === 'status' && (
            <div className="space-y-6">
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
                      Only sanitized transaction metadata is shared with AI. Addresses and transaction IDs are never exposed.
                    </p>
                  </div>
                </div>
              </div>

              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl surface-secondary">
                <div className="flex items-start space-x-4">
                  <div className="space-y-1">
                    <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
                      Enable AI Features
                    </label>
                    <p className="text-sm text-sanctuary-500 max-w-md">
                      {containerStatus?.available && containerStatus?.exists
                        ? 'The bundled AI container will start automatically.'
                        : 'Requires Ollama or another AI backend.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleToggleAI}
                  disabled={isSaving || isStartingContainer}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                    aiEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                  } ${(isSaving || isStartingContainer) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white dark:bg-sanctuary-200 shadow-md ring-1 ring-black/5 dark:ring-white/10 transition-transform ${
                      aiEnabled ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Container status message */}
              {(containerMessage || isStartingContainer) && (
                <div className="flex items-center space-x-2 text-sm text-primary-600 dark:text-primary-400">
                  {isStartingContainer && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{containerMessage}</span>
                </div>
              )}

              {/* Bundled Container Status */}
              {containerStatus?.available && containerStatus?.exists && (
                <div className="p-4 rounded-xl surface-secondary">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${containerStatus.running ? 'bg-emerald-500' : 'bg-sanctuary-400'}`} />
                      <div>
                        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                          Bundled Container: {containerStatus.running ? 'Running' : 'Stopped'}
                        </p>
                        <p className="text-xs text-sanctuary-500">sanctuary-ollama</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {containerStatus.running ? (
                        <button
                          onClick={handleStopContainer}
                          disabled={isStartingContainer}
                          className="px-3 py-1.5 text-sm bg-sanctuary-100 dark:bg-sanctuary-700 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-1"
                        >
                          <Square className="w-3 h-3" />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button
                          onClick={handleStartContainer}
                          disabled={isStartingContainer}
                          className="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-1"
                        >
                          {isStartingContainer ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          <span>Start</span>
                        </button>
                      )}
                      <button onClick={refreshContainerStatus} className="p-1.5 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Status Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg surface-secondary text-center">
                  <div className={`text-lg font-semibold ${aiEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-400'}`}>
                    {aiEnabled ? 'ON' : 'OFF'}
                  </div>
                  <div className="text-xs text-sanctuary-500">AI Status</div>
                </div>
                <div className="p-3 rounded-lg surface-secondary text-center">
                  <div className={`text-lg font-semibold ${aiEndpoint ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-400'}`}>
                    {aiEndpoint ? '✓' : '—'}
                  </div>
                  <div className="text-xs text-sanctuary-500">Endpoint</div>
                </div>
                <div className="p-3 rounded-lg surface-secondary text-center">
                  <div className={`text-lg font-semibold ${aiModel ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-400'}`}>
                    {aiModel ? '✓' : '—'}
                  </div>
                  <div className="text-xs text-sanctuary-500">Model</div>
                </div>
              </div>

              {/* Next Step Hint */}
              {aiEnabled && (
                <div className="p-4 rounded-xl bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700">
                  <p className="text-sm text-primary-700 dark:text-primary-700">
                    <span className="font-medium">Next:</span> Go to the <button onClick={() => setActiveTab('settings')} className="underline font-medium">Settings</button> tab to configure your AI endpoint.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              {/* Endpoint URL */}
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
                    className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-2"
                  >
                    {isDetecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    <span>Detect</span>
                  </button>
                </div>
                {detectMessage && (
                  <p className={`text-xs mt-1 ${detectMessage.includes('Found') || detectMessage.includes('Connected') || detectMessage.includes('saved') ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-500'}`}>
                    {detectMessage}
                  </p>
                )}
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
                    <span className={aiModel ? '' : 'text-sanctuary-400'}>{aiModel || 'Select a model...'}</span>
                    <div className="flex items-center space-x-2">
                      {isLoadingModels && <Loader2 className="w-4 h-4 animate-spin text-sanctuary-400" />}
                      <ChevronDown className="w-4 h-4 text-sanctuary-400" />
                    </div>
                  </button>
                  {showModelDropdown && (
                    <div className="absolute z-10 w-full mt-1 surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg max-h-60 overflow-y-auto">
                      {availableModels.length > 0 && (
                        <>
                          <div className="px-3 py-2 text-xs font-medium text-sanctuary-500 uppercase border-b border-sanctuary-100 dark:border-sanctuary-800">
                            Installed Models
                          </div>
                          {availableModels.map((model) => (
                            <button
                              key={model.name}
                              onClick={() => handleSelectModel(model.name)}
                              className={`w-full px-3 py-2 text-left hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors ${
                                aiModel === model.name ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                              }`}
                            >
                              <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{model.name}</span>
                              <span className="text-xs text-sanctuary-400 ml-2">{formatModelSize(model.size)}</span>
                            </button>
                          ))}
                        </>
                      )}
                      {availableModels.length === 0 && (
                        <div className="px-3 py-4 text-center text-sm text-sanctuary-500">
                          No models installed. Go to Models tab to download one.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-sanctuary-500">Select from installed models</p>
                  {aiEndpoint && (
                    <button onClick={loadModels} disabled={isLoadingModels} className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1">
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
                  className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save Configuration'}
                </button>
                <button
                  onClick={handleTestConnection}
                  disabled={aiStatus === 'checking' || !aiEndpoint || !aiModel}
                  className="px-4 py-2 border border-sanctuary-300 dark:border-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg disabled:opacity-50 transition-colors"
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
                  aiStatus === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : aiStatus === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-sanctuary-500'
                }`}>
                  {aiStatus === 'connected' && <Check className="w-4 h-4" />}
                  {aiStatus === 'error' && <AlertCircle className="w-4 h-4" />}
                  {aiStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span className="text-sm">{aiStatusMessage}</span>
                </div>
              )}

              {/* Next Step Hint */}
              {aiEndpoint && !aiModel && (
                <div className="p-4 rounded-xl bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700">
                  <p className="text-sm text-primary-700 dark:text-primary-700">
                    <span className="font-medium">Next:</span> Go to the <button onClick={() => setActiveTab('models')} className="underline font-medium">Models</button> tab to download a model.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Models Tab */}
          {activeTab === 'models' && (
            <div className="space-y-6">
              {/* Resource Notice */}
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Models use <strong>2-8 GB disk</strong> and <strong>4-16 GB RAM</strong>. Smaller models (1-3B) work on most systems.
                  </p>
                </div>
              </div>

              {/* Pull progress */}
              {(pullProgress || downloadProgress) && (
                <div className={`p-3 rounded-lg ${
                  pullProgress.includes('Successfully') ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : pullProgress.includes('Failed') || pullProgress.includes('Error') ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                    : 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                }`}>
                  {downloadProgress && downloadProgress.status === 'downloading' && downloadProgress.total > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium">
                        <span className="flex items-center space-x-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Downloading {pullModelName}</span>
                        </span>
                        <span className="tabular-nums">{downloadProgress.percent}%</span>
                      </div>
                      <div className="w-full bg-primary-200/60 dark:bg-sanctuary-800 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-gradient-to-r from-primary-500 to-primary-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${downloadProgress.percent}%` }} />
                      </div>
                      <div className="text-xs tabular-nums">{formatBytes(downloadProgress.completed)} / {formatBytes(downloadProgress.total)}</div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      {isPulling && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span className="text-sm">{downloadProgress?.status === 'pulling' ? 'Pulling manifest...' : downloadProgress?.status === 'verifying' ? 'Verifying...' : pullProgress}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Popular Models Grid */}
              <div>
                <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-3">Popular Models</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {POPULAR_MODELS.map((model) => {
                    const isInstalled = availableModels.some(m => m.name === model.name);
                    const isPullingThis = isPulling && pullModelName === model.name;
                    return (
                      <div key={model.name} className={`p-3 rounded-lg border ${isInstalled ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10' : 'border-sanctuary-200 dark:border-sanctuary-700'}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{model.name}</span>
                              {model.recommended && <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-primary-800 dark:bg-primary-100 text-primary-200 dark:text-primary-800 rounded">Recommended</span>}
                              {isInstalled && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                            </div>
                            <p className="text-xs text-sanctuary-500 mt-0.5">{model.description}</p>
                          </div>
                          {isInstalled ? (
                            <button onClick={() => handleDeleteModel(model.name)} disabled={isDeleting} className="px-2 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded disabled:opacity-50 transition-colors flex items-center space-x-1">
                              {isDeleting && deleteModelName === model.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                              <span>Delete</span>
                            </button>
                          ) : (
                            <button onClick={() => handlePullModel(model.name)} disabled={isPulling} className="px-3 py-1 text-xs bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded disabled:opacity-50 transition-colors flex items-center space-x-1">
                              {isPullingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              <span>Pull</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Custom Model Input */}
              <div className="pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
                <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">Pull Any Model</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    placeholder="e.g., codellama:13b, mixtral:8x7b"
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 placeholder:text-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    disabled={isPulling}
                  />
                  <button
                    onClick={() => { if (customModelName.trim()) { handlePullModel(customModelName.trim()); setCustomModelName(''); } }}
                    disabled={isPulling || !customModelName.trim()}
                    className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Pull</span>
                  </button>
                </div>
                <p className="text-xs text-sanctuary-500 mt-1">
                  Browse models at <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">ollama.com/library</a>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Features Info - Always visible at bottom */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h2 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">What AI Can Do</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg surface-secondary">
              <h3 className="text-xs font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1">Transaction Labeling</h3>
              <p className="text-xs text-sanctuary-500">AI suggests labels based on amount, direction, and your existing patterns.</p>
            </div>
            <div className="p-3 rounded-lg surface-secondary">
              <h3 className="text-xs font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1">Natural Language Queries</h3>
              <p className="text-xs text-sanctuary-500">Ask "Show my largest receives this month" and get filtered results.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Enable AI Confirmation Modal */}
      {showEnableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseEnableModal}
          />

          {/* Modal */}
          <div className="relative bg-white dark:bg-sanctuary-900 rounded-2xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-sanctuary-200 dark:border-sanctuary-700">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
                  <Brain className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <h2 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                  Enable AI Assistant
                </h2>
              </div>
              <button
                onClick={handleCloseEnableModal}
                className="p-1 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
              >
                <X className="w-5 h-5 text-sanctuary-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Info message */}
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  AI features run a local language model using Ollama. This requires significant system resources.
                </p>
              </div>

              {/* System Resources */}
              {isLoadingResources ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                  <span className="ml-2 text-sm text-sanctuary-500">Checking system resources...</span>
                </div>
              ) : systemResources ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    System Resources
                  </h3>

                  {/* RAM */}
                  <div className="flex items-center justify-between p-3 rounded-lg surface-secondary">
                    <div className="flex items-center space-x-3">
                      <Cpu className="w-4 h-4 text-sanctuary-500" />
                      <div>
                        <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">RAM</div>
                        <div className="text-xs text-sanctuary-500">
                          {(systemResources.ram.available / 1024).toFixed(1)} GB available of {(systemResources.ram.total / 1024).toFixed(1)} GB
                        </div>
                      </div>
                    </div>
                    {systemResources.ram.sufficient ? (
                      <Check className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                    )}
                  </div>

                  {/* Disk */}
                  <div className="flex items-center justify-between p-3 rounded-lg surface-secondary">
                    <div className="flex items-center space-x-3">
                      <HardDrive className="w-4 h-4 text-sanctuary-500" />
                      <div>
                        <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Disk Space</div>
                        <div className="text-xs text-sanctuary-500">
                          {(systemResources.disk.available / 1024).toFixed(1)} GB available
                        </div>
                      </div>
                    </div>
                    {systemResources.disk.sufficient ? (
                      <Check className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                    )}
                  </div>

                  {/* GPU */}
                  <div className="flex items-center justify-between p-3 rounded-lg surface-secondary">
                    <div className="flex items-center space-x-3">
                      <Zap className="w-4 h-4 text-sanctuary-500" />
                      <div>
                        <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">GPU Acceleration</div>
                        <div className="text-xs text-sanctuary-500">
                          {systemResources.gpu.available
                            ? systemResources.gpu.name
                            : 'Not detected (CPU will be used)'}
                        </div>
                      </div>
                    </div>
                    {systemResources.gpu.available ? (
                      <Check className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <span className="text-xs text-sanctuary-400">Optional</span>
                    )}
                  </div>

                  {/* Warnings */}
                  {!systemResources.overall.sufficient && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                      <div className="flex items-start space-x-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
                            Resource Warning
                          </div>
                          <ul className="mt-1 text-xs text-amber-700 dark:text-amber-300 list-disc list-inside">
                            {systemResources.overall.warnings.map((warning, i) => (
                              <li key={i}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
                  <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
                    Could not check system resources. You can still enable AI.
                  </p>
                </div>
              )}

              {/* Requirements summary */}
              <div className="text-xs text-sanctuary-500 space-y-1">
                <div><strong>Minimum requirements:</strong></div>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li>4 GB RAM available (8 GB recommended for 7B models)</li>
                  <li>8 GB disk space for model storage</li>
                  <li>GPU optional but significantly improves speed</li>
                </ul>
              </div>

              {/* Acknowledgment checkbox for insufficient resources */}
              {systemResources && !systemResources.overall.sufficient && (
                <label className="flex items-start space-x-3 p-3 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acknowledgeInsufficient}
                    onChange={(e) => setAcknowledgeInsufficient(e.target.checked)}
                    className="mt-0.5 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
                    I understand my system may not meet the recommended requirements and performance may be limited
                  </span>
                </label>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end space-x-3 p-4 border-t border-sanctuary-200 dark:border-sanctuary-700 bg-sanctuary-50 dark:bg-sanctuary-800">
              <button
                onClick={handleCloseEnableModal}
                className="px-4 py-2 text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performToggleAI(true)}
                disabled={isLoadingResources || (systemResources && !systemResources.overall.sufficient && !acknowledgeInsufficient)}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Enable AI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
