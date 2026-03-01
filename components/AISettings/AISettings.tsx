/**
 * AI Settings Administration Page
 *
 * Manage AI-powered features in an isolated security context.
 * This page configures the separate AI container that handles all AI operations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Brain, Download, Server, Loader2 } from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import * as aiApi from '../../src/api/ai';
import { createLogger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHandler';
import { useModelDownloadProgress, ModelDownloadProgress } from '../../hooks/useWebSocket';
import { invalidateAIStatusCache } from '../../hooks/useAIStatus';
import { useAIStatus } from './hooks/useAIStatus';
import { StatusTab } from './tabs/StatusTab';
import { SettingsTab } from './tabs/SettingsTab';
import { ModelsTab } from './tabs/ModelsTab';
import { EnableModal } from './components/EnableModal';
import type { AISettingsTab, PopularModel } from './types';

const log = createLogger('AISettings');

// URL to fetch popular models list
const POPULAR_MODELS_URL = 'https://raw.githubusercontent.com/nekoguntai/sanctuary/main/config/popular-models.json';

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

  // AI status (extracted hook)
  const { aiStatus, aiStatusMessage, handleTestConnection } = useAIStatus();

  // Detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState('');

  // Models state
  const [availableModels, setAvailableModels] = useState<aiApi.OllamaModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Popular models state (fetched from remote)
  const [popularModels, setPopularModels] = useState<PopularModel[]>([]);
  const [isLoadingPopularModels, setIsLoadingPopularModels] = useState(true);
  const [popularModelsError, setPopularModelsError] = useState<string | null>(null);

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

  // Load popular models from remote
  const loadPopularModels = async () => {
    setIsLoadingPopularModels(true);
    setPopularModelsError(null);
    try {
      const response = await fetch(POPULAR_MODELS_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.models && Array.isArray(data.models)) {
        setPopularModels(data.models);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      log.error('Failed to fetch popular models', { error });
      setPopularModelsError('Unable to fetch the latest popular models list. Please check your connection and try again.');
    } finally {
      setIsLoadingPopularModels(false);
    }
  };

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
    loadPopularModels();
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
    } catch (error) {
      log.error('Pull model failed', { error });
      setPullProgress(`Error: ${extractErrorMessage(error, 'Pull failed')}`);
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
    } catch (error) {
      log.error('Delete model failed', { error });
      alert(`Error: ${extractErrorMessage(error, 'Delete failed')}`);
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
    } catch (error) {
      log.error('Failed to start container', { error });
      setContainerMessage(`Error: ${extractErrorMessage(error, 'Failed to start')}`);
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
    } catch (error) {
      log.error('Failed to stop container', { error });
      setContainerMessage(`Error: ${extractErrorMessage(error, 'Failed to stop')}`);
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
                  ? 'bg-primary-600 dark:bg-sanctuary-500 text-white dark:text-sanctuary-100'
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
          {activeTab === 'status' && (
            <StatusTab
              aiEnabled={aiEnabled}
              isSaving={isSaving}
              isStartingContainer={isStartingContainer}
              containerMessage={containerMessage}
              containerStatus={containerStatus}
              aiEndpoint={aiEndpoint}
              aiModel={aiModel}
              onToggleAI={handleToggleAI}
              onStartContainer={handleStartContainer}
              onStopContainer={handleStopContainer}
              onRefreshContainerStatus={refreshContainerStatus}
              onNavigateToSettings={() => setActiveTab('settings')}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              aiEndpoint={aiEndpoint}
              aiModel={aiModel}
              isSaving={isSaving}
              isDetecting={isDetecting}
              detectMessage={detectMessage}
              showModelDropdown={showModelDropdown}
              availableModels={availableModels}
              isLoadingModels={isLoadingModels}
              aiStatus={aiStatus}
              aiStatusMessage={aiStatusMessage}
              saveSuccess={saveSuccess}
              saveError={saveError}
              onEndpointChange={setAiEndpoint}
              onDetectOllama={handleDetectOllama}
              onSelectModel={handleSelectModel}
              onToggleModelDropdown={() => setShowModelDropdown(!showModelDropdown)}
              onSaveConfig={handleSaveConfig}
              onTestConnection={handleTestConnection}
              onRefreshModels={loadModels}
              onNavigateToModels={() => setActiveTab('models')}
              formatModelSize={formatModelSize}
            />
          )}

          {activeTab === 'models' && (
            <ModelsTab
              pullProgress={pullProgress}
              downloadProgress={downloadProgress}
              isPulling={isPulling}
              pullModelName={pullModelName}
              customModelName={customModelName}
              isLoadingPopularModels={isLoadingPopularModels}
              popularModelsError={popularModelsError}
              popularModels={popularModels}
              availableModels={availableModels}
              isDeleting={isDeleting}
              deleteModelName={deleteModelName}
              onPullModel={handlePullModel}
              onDeleteModel={handleDeleteModel}
              onCustomModelNameChange={setCustomModelName}
              onLoadPopularModels={loadPopularModels}
              formatBytes={formatBytes}
            />
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
      <EnableModal
        showEnableModal={showEnableModal}
        isLoadingResources={isLoadingResources}
        systemResources={systemResources}
        acknowledgeInsufficient={acknowledgeInsufficient}
        onAcknowledgeChange={setAcknowledgeInsufficient}
        onClose={handleCloseEnableModal}
        onEnable={() => performToggleAI(true)}
      />
    </div>
  );
}
