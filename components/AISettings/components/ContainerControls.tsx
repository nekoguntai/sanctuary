import { Loader2, Play, Square, RefreshCw } from 'lucide-react';
import type { ContainerControlsProps } from '../types';

export function ContainerControls({
  containerStatus,
  isStartingContainer,
  onStartContainer,
  onStopContainer,
  onRefreshContainerStatus,
}: ContainerControlsProps) {
  return (
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
              onClick={onStopContainer}
              disabled={isStartingContainer}
              className="px-3 py-1.5 text-sm bg-sanctuary-100 dark:bg-sanctuary-700 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-1"
            >
              <Square className="w-3 h-3" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={onStartContainer}
              disabled={isStartingContainer}
              className="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-1"
            >
              {isStartingContainer ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              <span>Start</span>
            </button>
          )}
          <button onClick={onRefreshContainerStatus} className="p-1.5 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
