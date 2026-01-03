import React, { useState, useEffect, useRef } from 'react';
import { Shield, UserPlus, Check, AlertCircle, Radio, Users, Layers, Gauge, RefreshCw, Zap, Clock } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import type { WebSocketStats, RateLimitEvent } from '../src/api/admin';
import { createLogger } from '../utils/logger';
import { Button } from './ui/Button';

const log = createLogger('SystemSettings');

// Tab type definition
type SystemSettingsTab = 'access' | 'websocket';

// Tab configuration
const SYSTEM_SETTINGS_TABS: { id: SystemSettingsTab; name: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'access', name: 'Access Control', icon: Shield },
  { id: 'websocket', name: 'WebSocket', icon: Radio },
];

// WebSocket Stats Component
const WebSocketStatsCard: React.FC = () => {
  const [stats, setStats] = useState<WebSocketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadStats = async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    setError(null);
    try {
      const data = await adminApi.getWebSocketStats();
      setStats(data);
    } catch (err) {
      log.error('Failed to load WebSocket stats', { error: err });
      setError('Failed to load WebSocket statistics');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadStats();
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => loadStats(), 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-1/3"></div>
          <div className="h-20 bg-sanctuary-200 dark:bg-sanctuary-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-6">
        <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const connectionPercent = (stats.connections.current / stats.connections.max) * 100;

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">WebSocket Status</h3>
                <p className="text-sm text-sanctuary-500">Real-time connection monitoring</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadStats(true)}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Connection Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="surface-secondary rounded-xl p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Users className="w-4 h-4 text-primary-500" />
                <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Connections</span>
              </div>
              <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                {stats.connections.current}
                <span className="text-sm font-normal text-sanctuary-500"> / {stats.connections.max}</span>
              </div>
              <div className="mt-2 h-1.5 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    connectionPercent > 80 ? 'bg-rose-500' : connectionPercent > 50 ? 'bg-warning-500' : 'bg-success-500'
                  }`}
                  style={{ width: `${Math.min(connectionPercent, 100)}%` }}
                />
              </div>
            </div>

            <div className="surface-secondary rounded-xl p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Layers className="w-4 h-4 text-primary-500" />
                <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Subscriptions</span>
              </div>
              <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                {stats.subscriptions.total}
              </div>
              <div className="text-xs text-sanctuary-500 mt-1">
                {stats.subscriptions.channels} active channels
              </div>
            </div>
          </div>

          {/* User Stats */}
          <div className="flex items-center justify-between p-3 surface-secondary rounded-xl">
            <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">Unique Users Connected</span>
            <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {stats.connections.uniqueUsers}
            </span>
          </div>

          {/* Rate Limits Configuration */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center space-x-2 mb-3">
              <Gauge className="w-4 h-4 text-sanctuary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Rate Limit Configuration</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Messages/sec</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.maxMessagesPerSecond}</span>
              </div>
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Max per user</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.connections.maxPerUser}</span>
              </div>
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Grace period</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.gracePeriodMs / 1000}s</span>
              </div>
              <div className="flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Grace limit</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.gracePeriodMessageLimit}</span>
              </div>
              <div className="col-span-2 flex justify-between p-2 surface-muted rounded-lg">
                <span className="text-sanctuary-500">Max subscriptions/connection</span>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{stats.rateLimits.maxSubscriptionsPerConnection}</span>
              </div>
            </div>
          </div>

          {/* Active Channels (collapsible, grouped) */}
          {stats.subscriptions.channelList.length > 0 && (
            <details className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
              <summary className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400">
                Active Channels ({stats.subscriptions.channelList.length})
              </summary>
              <div className="mt-3 space-y-3">
                {/* Group channels by type */}
                {(() => {
                  const walletChannels = stats.subscriptions.channelList.filter(c => c.startsWith('wallet:'));
                  const globalChannels = stats.subscriptions.channelList.filter(c => !c.startsWith('wallet:'));
                  const walletIds = [...new Set(walletChannels.map(c => c.split(':')[1]))];

                  return (
                    <>
                      {globalChannels.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-sanctuary-400 mb-1.5">Global</div>
                          <div className="flex flex-wrap gap-1.5">
                            {globalChannels.map((channel) => (
                              <span
                                key={channel}
                                className="px-2 py-0.5 text-[10px] font-mono bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded"
                              >
                                {channel}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {walletIds.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-sanctuary-400 mb-1.5">
                            Wallets ({walletIds.length})
                          </div>
                          <div className="max-h-32 overflow-y-auto space-y-1">
                            {walletIds.map((walletId) => {
                              const channels = walletChannels.filter(c => c.split(':')[1] === walletId);
                              const types = channels.map(c => c.split(':')[2] || 'base').join(', ');
                              return (
                                <div key={walletId} className="flex items-center gap-2 text-[10px]">
                                  <span className="font-mono text-sanctuary-500 truncate max-w-[100px]" title={walletId}>
                                    {walletId.slice(0, 8)}...
                                  </span>
                                  <span className="text-sanctuary-400">→</span>
                                  <span className="text-sanctuary-600 dark:text-sanctuary-400">{types}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </details>
          )}

          {/* Rate Limit Events Log */}
          <details className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <summary className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Rate Limit Events
              {stats.recentRateLimitEvents.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full">
                  {stats.recentRateLimitEvents.length}
                </span>
              )}
            </summary>
            <div className="mt-3">
              {stats.recentRateLimitEvents.length === 0 ? (
                <div className="text-sm text-sanctuary-400 italic">No rate limit events recorded</div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {stats.recentRateLimitEvents.map((event, index) => (
                    <div
                      key={`${event.timestamp}-${index}`}
                      className="flex items-start gap-3 p-2 surface-muted rounded-lg text-sm"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <AlertCircle className="w-4 h-4 text-rose-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                            event.reason === 'grace_period_exceeded'
                              ? 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400'
                              : event.reason === 'per_second_exceeded'
                              ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                          }`}>
                            {event.reason.replace(/_/g, ' ')}
                          </span>
                          {event.userId && (
                            <span className="text-[10px] font-mono text-sanctuary-500 truncate max-w-[80px]" title={event.userId}>
                              {event.userId.slice(0, 8)}...
                            </span>
                          )}
                        </div>
                        <div className="text-sanctuary-600 dark:text-sanctuary-400">{event.details}</div>
                        <div className="flex items-center gap-1 text-[10px] text-sanctuary-400 mt-1">
                          <Clock className="w-3 h-3" />
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};

// Access Control Tab Component
const AccessControlTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

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
      // Clear any existing timeout and set new one
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      log.error('Failed to update settings', { error });
      setSaveError('Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading access control settings...</div>;
  }

  return (
    <div className="space-y-6">
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
                className={`inline-block h-6 w-6 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
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

export const SystemSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SystemSettingsTab>('access');

  return (
    <div className="max-w-2xl mx-auto animate-fade-in pb-12">
      <div className="mb-6">
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">System Settings</h2>
        <p className="text-sanctuary-500">Configure system-wide settings for Sanctuary</p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex space-x-1 surface-secondary rounded-xl p-1">
          {SYSTEM_SETTINGS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
                  : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'access' && <AccessControlTab />}
        {activeTab === 'websocket' && <WebSocketStatsCard />}
      </div>
    </div>
  );
};
