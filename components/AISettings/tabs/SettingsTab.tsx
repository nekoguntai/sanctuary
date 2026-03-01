import React from 'react';
import { Check, AlertCircle, Loader2, Search, ChevronDown, RefreshCw } from 'lucide-react';
import type { SettingsTabProps } from '../types';

export function SettingsTab({
  aiEndpoint,
  aiModel,
  isSaving,
  isDetecting,
  detectMessage,
  showModelDropdown,
  availableModels,
  isLoadingModels,
  aiStatus,
  aiStatusMessage,
  saveSuccess,
  saveError,
  onEndpointChange,
  onDetectOllama,
  onSelectModel,
  onToggleModelDropdown,
  onSaveConfig,
  onTestConnection,
  onRefreshModels,
  onNavigateToModels,
  formatModelSize,
}: SettingsTabProps) {
  return (
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
            onChange={(e) => onEndpointChange(e.target.value)}
            placeholder="http://host.docker.internal:11434"
            className="flex-1 px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={onDetectOllama}
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
            onClick={onToggleModelDropdown}
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
                      onClick={() => onSelectModel(model.name)}
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
            <button onClick={onRefreshModels} disabled={isLoadingModels} className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1">
              <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onSaveConfig}
          disabled={isSaving || !aiEndpoint || !aiModel}
          className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </button>
        <button
          onClick={onTestConnection}
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
            <span className="font-medium">Next:</span> Go to the <button onClick={onNavigateToModels} className="underline font-medium">Models</button> tab to download a model.
          </p>
        </div>
      )}
    </div>
  );
}
