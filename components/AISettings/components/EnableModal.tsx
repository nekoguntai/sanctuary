import { Brain, Check, AlertTriangle, Loader2, X, Cpu, HardDrive, Zap } from 'lucide-react';
import type { EnableModalProps } from '../types';

export function EnableModal({
  showEnableModal,
  isLoadingResources,
  systemResources,
  acknowledgeInsufficient,
  onAcknowledgeChange,
  onClose,
  onEnable,
}: EnableModalProps) {
  if (!showEnableModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
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
            onClick={onClose}
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
                onChange={(e) => onAcknowledgeChange(e.target.checked)}
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
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onEnable}
            disabled={isLoadingResources || (systemResources != null && !systemResources.overall.sufficient && !acknowledgeInsufficient)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Enable AI
          </button>
        </div>
      </div>
    </div>
  );
}
