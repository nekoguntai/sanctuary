/**
 * Monitoring Administration Page
 *
 * Provides easy access to monitoring tools (Grafana, Prometheus, Jaeger)
 * with status indicators and configurable URLs.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  BarChart3,
  Network,
  ExternalLink,
  RefreshCw,
  Settings,
  X,
  Info,
  AlertCircle,
  Loader2,
  Key,
  Eye,
  EyeOff,
  User,
  ShieldOff,
} from 'lucide-react';
import * as adminApi from '../src/api/admin';
import type { MonitoringService, MonitoringServicesResponse, GrafanaConfig } from '../src/api/admin';
import { createLogger } from '../utils/logger';
import { Button } from './ui/Button';

const log = createLogger('Monitoring');

// Icon mapping for service cards
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  BarChart3,
  Activity,
  Network,
};

/**
 * Status badge showing service health
 */
const StatusBadge: React.FC<{ status?: MonitoringService['status'] }> = ({ status }) => {
  if (!status || status === 'unknown') {
    return (
      <span className="flex items-center space-x-1 text-xs text-sanctuary-400">
        <span className="w-2 h-2 rounded-full bg-sanctuary-300 dark:bg-sanctuary-600" />
        <span>Unknown</span>
      </span>
    );
  }

  if (status === 'healthy') {
    return (
      <span className="flex items-center space-x-1 text-xs text-emerald-600 dark:text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span>Running</span>
      </span>
    );
  }

  return (
    <span className="flex items-center space-x-1 text-xs text-rose-600 dark:text-rose-400">
      <span className="w-2 h-2 rounded-full bg-rose-500" />
      <span>Unreachable</span>
    </span>
  );
};

/**
 * Credentials display for services that require authentication
 */
interface ServiceCredentials {
  username: string;
  passwordHint: string;
  passwordSource: string;
  hasAuth: boolean;
}

/**
 * Service card component
 */
const ServiceCard: React.FC<{
  service: MonitoringService;
  onEditUrl: (service: MonitoringService) => void;
  hostname: string;
  credentials?: ServiceCredentials;
  anonymousAccess?: boolean;
  onToggleAnonymous?: () => void;
  isTogglingAnonymous?: boolean;
}> = ({ service, onEditUrl, hostname, credentials, anonymousAccess, onToggleAnonymous, isTogglingAnonymous }) => {
  const Icon = iconMap[service.icon] || Activity;
  const [showPassword, setShowPassword] = useState(false);

  // Generate actual URL by replacing {host} placeholder
  const actualUrl = service.url.includes('{host}')
    ? `http://${hostname}:${service.defaultPort}`
    : service.url;

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg">
            <Icon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {service.name}
            </h3>
            <p className="text-sm text-sanctuary-500">{service.description}</p>
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>

      {/* Credentials section */}
      {credentials && (
        <div className="mt-3 p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-900 border border-sanctuary-200 dark:border-sanctuary-700">
          {credentials.hasAuth ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2 text-sanctuary-600 dark:text-sanctuary-400">
                  <User className="w-3.5 h-3.5" />
                  <span>Username:</span>
                </div>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{credentials.username}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2 text-sanctuary-600 dark:text-sanctuary-400">
                  <Key className="w-3.5 h-3.5" />
                  <span>Password:</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">
                    {showPassword ? credentials.passwordHint : '••••••••'}
                  </span>
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
                    title={showPassword ? 'Hide password hint' : 'Show password hint'}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-sanctuary-400 mt-1">
                Password from {credentials.passwordSource} environment variable
              </p>

              {/* Anonymous access toggle for Grafana */}
              {onToggleAnonymous && (
                <div className="mt-2 pt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center space-x-2 text-sm text-sanctuary-600 dark:text-sanctuary-400">
                      <ShieldOff className="w-3.5 h-3.5" />
                      <span>Anonymous viewing</span>
                    </div>
                    <button
                      onClick={onToggleAnonymous}
                      disabled={isTogglingAnonymous}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        anonymousAccess
                          ? 'bg-primary-600'
                          : 'bg-sanctuary-300 dark:bg-sanctuary-600'
                      } ${isTogglingAnonymous ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          anonymousAccess ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                        style={{ transform: anonymousAccess ? 'translateX(16px)' : 'translateX(4px)' }}
                      />
                    </button>
                  </label>
                  <p className="text-[9px] text-sanctuary-400 mt-1">
                    Requires container restart to take effect
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-sm text-emerald-600 dark:text-emerald-400">
              <ShieldOff className="w-4 h-4" />
              <span>No authentication required</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm text-sanctuary-600 dark:text-sanctuary-400">
          {service.isCustomUrl ? (
            <span className="px-2 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded">
              Custom URL
            </span>
          ) : (
            <span className="font-mono text-xs">:{service.defaultPort}</span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => onEditUrl(service)}
            className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            title="Configure URL"
          >
            <Settings className="w-4 h-4" />
          </button>
          <a
            href={actualUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <span>Open</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

/**
 * Main Monitoring component
 */
export const Monitoring: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MonitoringServicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Grafana config state
  const [grafanaConfig, setGrafanaConfig] = useState<GrafanaConfig | null>(null);
  const [isTogglingAnonymous, setIsTogglingAnonymous] = useState(false);

  // Edit URL modal state
  const [editingService, setEditingService] = useState<MonitoringService | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Get hostname for URL generation
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  const loadServices = useCallback(async (checkHealth = false) => {
    if (checkHealth) setIsRefreshing(true);
    setError(null);

    try {
      const [servicesResult, grafanaResult] = await Promise.all([
        adminApi.getMonitoringServices(checkHealth),
        adminApi.getGrafanaConfig().catch(() => null), // Non-fatal if fails
      ]);
      setData(servicesResult);
      if (grafanaResult) {
        setGrafanaConfig(grafanaResult);
      }
    } catch (err) {
      log.error('Failed to load monitoring services', { error: err });
      setError('Failed to load monitoring services');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadServices(true); // Check health on initial load
  }, [loadServices]);

  // Toggle anonymous access for Grafana
  const handleToggleAnonymous = useCallback(async () => {
    if (!grafanaConfig) return;

    setIsTogglingAnonymous(true);
    try {
      const newValue = !grafanaConfig.anonymousAccess;
      await adminApi.updateGrafanaConfig({ anonymousAccess: newValue });
      setGrafanaConfig({ ...grafanaConfig, anonymousAccess: newValue });
    } catch (err) {
      log.error('Failed to toggle anonymous access', { error: err });
    } finally {
      setIsTogglingAnonymous(false);
    }
  }, [grafanaConfig]);

  // Build credentials map for each service
  const getCredentialsForService = useCallback((serviceId: string): ServiceCredentials | undefined => {
    if (serviceId === 'grafana' && grafanaConfig) {
      return {
        username: grafanaConfig.username,
        passwordHint: grafanaConfig.passwordHint,
        passwordSource: grafanaConfig.passwordSource,
        hasAuth: true,
      };
    }
    // Prometheus and Jaeger don't have authentication by default
    if (serviceId === 'prometheus' || serviceId === 'jaeger') {
      return {
        username: '',
        passwordHint: '',
        passwordSource: '',
        hasAuth: false,
      };
    }
    return undefined;
  }, [grafanaConfig]);

  const handleEditUrl = (service: MonitoringService) => {
    setEditingService(service);
    setEditUrl(service.isCustomUrl ? service.url : '');
    setSaveError(null);
  };

  const handleCloseModal = () => {
    setEditingService(null);
    setEditUrl('');
    setSaveError(null);
  };

  const handleSaveUrl = async () => {
    if (!editingService) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      await adminApi.updateMonitoringServiceUrl(
        editingService.id,
        editUrl.trim() || null
      );
      await loadServices(false);
      handleCloseModal();
    } catch (err) {
      log.error('Failed to save custom URL', { error: err });
      setSaveError('Failed to save custom URL');
    } finally {
      setIsSaving(false);
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
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">
              Monitoring
            </h2>
            <p className="text-sanctuary-500">
              Access observability tools for metrics, logs, and tracing
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadServices(true)}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
        </div>
      </div>

      {/* Info banner when monitoring is not enabled */}
      {data && !data.enabled && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-start space-x-3">
            <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Monitoring Stack Not Enabled
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                To enable monitoring, start Sanctuary with the monitoring compose file:
              </p>
              <code className="block mt-2 text-xs font-mono bg-amber-100 dark:bg-amber-900/40 p-2 rounded text-amber-800 dark:text-amber-200">
                docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
              </code>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
          <div className="flex items-center space-x-2 text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Services Grid */}
      {data && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onEditUrl={handleEditUrl}
              hostname={hostname}
              credentials={getCredentialsForService(service.id)}
              anonymousAccess={service.id === 'grafana' ? grafanaConfig?.anonymousAccess : undefined}
              onToggleAnonymous={service.id === 'grafana' ? handleToggleAnonymous : undefined}
              isTogglingAnonymous={service.id === 'grafana' ? isTogglingAnonymous : undefined}
            />
          ))}
        </div>
      )}

      {/* Info Section */}
      <div className="mt-8 surface-secondary rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          About Monitoring
        </h4>
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          The monitoring stack provides observability into Sanctuary's operation:
        </p>
        <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-2 space-y-1 list-disc list-inside">
          <li><strong>Grafana</strong> - Pre-configured dashboards for wallet sync, API performance, and system health</li>
          <li><strong>Prometheus</strong> - Metrics collection from backend /metrics endpoint</li>
          <li><strong>Jaeger</strong> - Distributed request tracing (requires OTEL_TRACING_ENABLED=true)</li>
        </ul>
      </div>

      {/* Edit URL Modal */}
      {editingService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseModal}
          />
          <div className="relative surface-elevated rounded-2xl shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 max-w-md w-full animate-fade-in">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Configure {editingService.name} URL
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="p-1 rounded-lg text-sanctuary-400 hover:text-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-sanctuary-500 mb-4">
                Use a custom URL for reverse proxy setups. Leave empty to use the default port-based URL.
              </p>

              {saveError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 text-sm flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                    Custom URL
                  </label>
                  <input
                    type="url"
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    placeholder={`https://${editingService.id}.yourdomain.com`}
                    className="w-full px-3 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-sanctuary-400 mt-1">
                    Default: http://{hostname}:{editingService.defaultPort}
                  </p>
                </div>

                <div className="flex justify-end space-x-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={handleCloseModal}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveUrl}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Monitoring;
