import React, { useState } from 'react';
import { NodeConfig as NodeConfigType, ElectrumServer } from '../types';
import { Button } from './ui/Button';
import {
  Server,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  CheckCircle,
  XCircle,
  Globe,
  Layers,
  RefreshCw,
  Loader2,
  ChevronRight,
  Radio,
} from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { createLogger } from '../utils/logger';

const log = createLogger('NetworkConnectionCard');

type NetworkType = 'mainnet' | 'testnet' | 'signet';
type ConnectionMode = 'singleton' | 'pool';

// Preset servers for each network
const PRESET_SERVERS: Record<NetworkType, Array<{ name: string; host: string; port: number; useSsl: boolean }>> = {
  mainnet: [
    { name: 'Blockstream (SSL)', host: 'electrum.blockstream.info', port: 50002, useSsl: true },
    { name: 'Blockstream (TCP)', host: 'electrum.blockstream.info', port: 50001, useSsl: false },
    { name: 'BlueWallet (TCP)', host: 'electrum1.bluewallet.io', port: 50001, useSsl: false },
  ],
  testnet: [
    { name: 'Blockstream Testnet', host: 'electrum.blockstream.info', port: 60002, useSsl: true },
    { name: 'Aranguren Testnet', host: 'testnet.aranguren.org', port: 51002, useSsl: true },
  ],
  signet: [
    { name: 'Mutinynet Signet', host: 'electrum.mutinynet.com', port: 50002, useSsl: true },
    { name: 'Mempool Signet', host: 'mempool.space', port: 60602, useSsl: true },
  ],
};

// Network color schemes
const NETWORK_COLORS: Record<NetworkType, { bg: string; border: string; text: string; accent: string; badge: string }> = {
  mainnet: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800',
    text: 'text-emerald-700 dark:text-emerald-300',
    accent: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-500',
  },
  testnet: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-300',
    accent: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500',
  },
  signet: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    text: 'text-purple-700 dark:text-purple-300',
    accent: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    badge: 'bg-purple-500',
  },
};

interface NetworkConnectionCardProps {
  network: NetworkType;
  config: NodeConfigType;
  servers: ElectrumServer[];
  onConfigChange: (updates: Partial<NodeConfigType>) => void;
  onServersChange: (servers: ElectrumServer[]) => void;
  onTestConnection: (host: string, port: number, ssl: boolean) => Promise<{ success: boolean; message: string }>;
}

export const NetworkConnectionCard: React.FC<NetworkConnectionCardProps> = ({
  network,
  config,
  servers,
  onConfigChange,
  onServersChange,
  onTestConnection,
}) => {
  const [isExpanded, setIsExpanded] = useState(network === 'mainnet');
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [newServer, setNewServer] = useState({ label: '', host: '', port: getDefaultPort(network), useSsl: true });
  const [serverActionLoading, setServerActionLoading] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [serverTestStatus, setServerTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});

  const colors = NETWORK_COLORS[network];
  const presets = PRESET_SERVERS[network];

  // Get network-specific config values
  const isEnabled = network === 'mainnet' ? true : getNetworkEnabled(network, config);
  const mode = getNetworkMode(network, config);
  const singletonHost = getNetworkSingletonHost(network, config);
  const singletonPort = getNetworkSingletonPort(network, config);
  const singletonSsl = getNetworkSingletonSsl(network, config);
  const poolMin = getNetworkPoolMin(network, config);
  const poolMax = getNetworkPoolMax(network, config);
  const poolLoadBalancing = getNetworkPoolLoadBalancing(network, config);

  function getDefaultPort(net: NetworkType): number {
    return net === 'testnet' ? 60002 : 50002;
  }

  function getNetworkEnabled(net: NetworkType, cfg: NodeConfigType): boolean {
    if (net === 'testnet') return cfg.testnetEnabled ?? false;
    if (net === 'signet') return cfg.signetEnabled ?? false;
    return true;
  }

  function getNetworkMode(net: NetworkType, cfg: NodeConfigType): ConnectionMode {
    if (net === 'mainnet') return (cfg.mainnetMode as ConnectionMode) ?? 'pool';
    if (net === 'testnet') return (cfg.testnetMode as ConnectionMode) ?? 'singleton';
    if (net === 'signet') return (cfg.signetMode as ConnectionMode) ?? 'singleton';
    return 'singleton';
  }

  function getNetworkSingletonHost(net: NetworkType, cfg: NodeConfigType): string {
    if (net === 'mainnet') return cfg.mainnetSingletonHost ?? 'electrum.blockstream.info';
    if (net === 'testnet') return cfg.testnetSingletonHost ?? 'electrum.blockstream.info';
    if (net === 'signet') return cfg.signetSingletonHost ?? 'electrum.mutinynet.com';
    return '';
  }

  function getNetworkSingletonPort(net: NetworkType, cfg: NodeConfigType): number {
    if (net === 'mainnet') return cfg.mainnetSingletonPort ?? 50002;
    if (net === 'testnet') return cfg.testnetSingletonPort ?? 60002;
    if (net === 'signet') return cfg.signetSingletonPort ?? 50002;
    return 50002;
  }

  function getNetworkSingletonSsl(net: NetworkType, cfg: NodeConfigType): boolean {
    if (net === 'mainnet') return cfg.mainnetSingletonSsl ?? true;
    if (net === 'testnet') return cfg.testnetSingletonSsl ?? true;
    if (net === 'signet') return cfg.signetSingletonSsl ?? true;
    return true;
  }

  function getNetworkPoolMin(net: NetworkType, cfg: NodeConfigType): number {
    if (net === 'mainnet') return cfg.mainnetPoolMin ?? 1;
    if (net === 'testnet') return cfg.testnetPoolMin ?? 1;
    if (net === 'signet') return cfg.signetPoolMin ?? 1;
    return 1;
  }

  function getNetworkPoolMax(net: NetworkType, cfg: NodeConfigType): number {
    if (net === 'mainnet') return cfg.mainnetPoolMax ?? 5;
    if (net === 'testnet') return cfg.testnetPoolMax ?? 3;
    if (net === 'signet') return cfg.signetPoolMax ?? 3;
    return 5;
  }

  function getNetworkPoolLoadBalancing(net: NetworkType, cfg: NodeConfigType): string {
    if (net === 'mainnet') return cfg.mainnetPoolLoadBalancing ?? 'round_robin';
    if (net === 'testnet') return cfg.testnetPoolLoadBalancing ?? 'round_robin';
    if (net === 'signet') return cfg.signetPoolLoadBalancing ?? 'round_robin';
    return 'round_robin';
  }

  const updateNetworkConfig = (field: string, value: any) => {
    const prefix = network;
    const fieldMap: Record<string, string> = {
      enabled: `${prefix}Enabled`,
      mode: `${prefix}Mode`,
      singletonHost: `${prefix}SingletonHost`,
      singletonPort: `${prefix}SingletonPort`,
      singletonSsl: `${prefix}SingletonSsl`,
      poolMin: `${prefix}PoolMin`,
      poolMax: `${prefix}PoolMax`,
      poolLoadBalancing: `${prefix}PoolLoadBalancing`,
    };
    onConfigChange({ [fieldMap[field]]: value });
  };

  const handleTestSingleton = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await onTestConnection(singletonHost, singletonPort, singletonSsl);
      setTestStatus(result.success ? 'success' : 'error');
      setTestMessage(result.message);
    } catch (error: any) {
      setTestStatus('error');
      setTestMessage(error.message || 'Connection failed');
    }
  };

  const handleTestServer = async (server: ElectrumServer) => {
    setServerTestStatus(prev => ({ ...prev, [server.id]: 'testing' }));
    try {
      const result = await onTestConnection(server.host, server.port, server.useSsl);
      const status = result.success ? 'success' : 'error';
      setServerTestStatus(prev => ({ ...prev, [server.id]: status }));
      // Auto-clear status after 5 seconds
      setTimeout(() => {
        setServerTestStatus(prev => ({ ...prev, [server.id]: 'idle' }));
      }, 5000);
    } catch {
      setServerTestStatus(prev => ({ ...prev, [server.id]: 'error' }));
      // Auto-clear error status after 5 seconds
      setTimeout(() => {
        setServerTestStatus(prev => ({ ...prev, [server.id]: 'idle' }));
      }, 5000);
    }
  };

  const handleAddServer = async () => {
    if (!newServer.label || !newServer.host) return;
    setServerActionLoading('add');
    try {
      const server = await adminApi.addElectrumServer({
        ...newServer,
        network,
        enabled: true,
        priority: servers.length + 1,
      });
      onServersChange([...servers, server]);
      setNewServer({ label: '', host: '', port: getDefaultPort(network), useSsl: true });
      setIsAddingServer(false);
    } catch (error) {
      log.error('Failed to add server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    setServerActionLoading(serverId);
    try {
      await adminApi.deleteElectrumServer(serverId);
      onServersChange(servers.filter(s => s.id !== serverId));
    } catch (error) {
      log.error('Failed to delete server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleToggleServer = async (server: ElectrumServer) => {
    setServerActionLoading(server.id);
    try {
      await adminApi.updateElectrumServer(server.id, { enabled: !server.enabled });
      onServersChange(servers.map(s => s.id === server.id ? { ...s, enabled: !s.enabled } : s));
    } catch (error) {
      log.error('Failed to toggle server', { error });
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleMoveServer = async (serverId: string, direction: 'up' | 'down') => {
    const index = servers.findIndex(s => s.id === serverId);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === servers.length - 1) return;

    const newServers = [...servers];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newServers[index], newServers[swapIndex]] = [newServers[swapIndex], newServers[index]];

    // Update priorities
    const reordered = newServers.map((s, i) => ({ ...s, priority: i }));
    onServersChange(reordered);

    try {
      await adminApi.reorderElectrumServers(reordered.map(s => s.id));
    } catch (error) {
      log.error('Failed to reorder servers', { error });
    }
  };

  const handleAddPreset = (preset: typeof presets[0]) => {
    setNewServer({
      label: preset.name,
      host: preset.host,
      port: preset.port,
      useSsl: preset.useSsl,
    });
    setIsAddingServer(true);
  };

  const networkLabel = network.charAt(0).toUpperCase() + network.slice(1);

  // Collapsed view for disabled networks
  if (!isEnabled && network !== 'mainnet') {
    return (
      <div className={`surface-elevated rounded-2xl border ${colors.border} overflow-hidden`}>
        <div
          className={`p-4 ${colors.bg} cursor-pointer`}
          onClick={() => updateNetworkConfig('enabled', true)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={`w-2 h-2 rounded-full bg-sanctuary-400`} />
              <div>
                <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">{networkLabel}</h3>
                <p className="text-xs text-sanctuary-500">Click to enable</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); updateNetworkConfig('enabled', true); }}>
              Enable
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`surface-elevated rounded-2xl border ${colors.border} overflow-hidden`}>
      {/* Header */}
      <div
        className={`p-4 ${colors.bg} cursor-pointer`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-2 h-2 rounded-full ${colors.badge}`} />
            <div>
              <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">{networkLabel}</h3>
              <p className="text-xs text-sanctuary-500">
                {mode === 'pool' ? `Pool mode (${servers.length} servers)` : 'Singleton mode'}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {network !== 'mainnet' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); updateNetworkConfig('enabled', false); }}
                className="text-xs"
              >
                Disable
              </Button>
            )}
            <ChevronRight className={`w-5 h-5 text-sanctuary-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </div>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-5 space-y-6">
          {/* Mode Selector */}
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">Connection Mode</label>
            <div className="flex space-x-3">
              <button
                onClick={() => updateNetworkConfig('mode', 'singleton')}
                className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                  mode === 'singleton'
                    ? `${colors.border} ${colors.bg}`
                    : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Radio className={`w-4 h-4 ${mode === 'singleton' ? colors.text : 'text-sanctuary-400'}`} />
                  <span className={`font-medium ${mode === 'singleton' ? colors.text : 'text-sanctuary-600 dark:text-sanctuary-400'}`}>
                    Singleton
                  </span>
                </div>
                <p className="text-xs text-sanctuary-500 mt-1 text-left">Single server connection</p>
              </button>
              <button
                onClick={() => updateNetworkConfig('mode', 'pool')}
                className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                  mode === 'pool'
                    ? `${colors.border} ${colors.bg}`
                    : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Layers className={`w-4 h-4 ${mode === 'pool' ? colors.text : 'text-sanctuary-400'}`} />
                  <span className={`font-medium ${mode === 'pool' ? colors.text : 'text-sanctuary-600 dark:text-sanctuary-400'}`}>
                    Pool
                  </span>
                </div>
                <p className="text-xs text-sanctuary-500 mt-1 text-left">Multi-server with failover</p>
              </button>
            </div>
          </div>

          {/* Singleton Config */}
          {mode === 'singleton' && (
            <div className="space-y-4 p-4 surface-muted rounded-xl">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Host</label>
                  <input
                    type="text"
                    value={singletonHost}
                    onChange={(e) => updateNetworkConfig('singletonHost', e.target.value)}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                    placeholder="electrum.example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Port</label>
                  <input
                    type="number"
                    value={singletonPort}
                    onChange={(e) => updateNetworkConfig('singletonPort', parseInt(e.target.value) || 50002)}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Protocol</label>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => updateNetworkConfig('singletonSsl', true)}
                      className={`px-3 py-1 rounded-lg text-sm ${
                        singletonSsl ? `${colors.accent}` : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
                      }`}
                    >
                      SSL
                    </button>
                    <button
                      onClick={() => updateNetworkConfig('singletonSsl', false)}
                      className={`px-3 py-1 rounded-lg text-sm ${
                        !singletonSsl ? `${colors.accent}` : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
                      }`}
                    >
                      TCP
                    </button>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleTestSingleton}
                  disabled={testStatus === 'testing'}
                >
                  {testStatus === 'testing' ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Testing</>
                  ) : (
                    <>Test Connection</>
                  )}
                </Button>
              </div>

              {testMessage && (
                <div className={`p-3 rounded-lg text-sm flex items-center space-x-2 ${
                  testStatus === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                }`}>
                  {testStatus === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  <span>{testMessage}</span>
                </div>
              )}

              {/* Presets */}
              <div>
                <label className="block text-xs font-medium text-sanctuary-500 mb-2">Quick Presets</label>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => {
                        updateNetworkConfig('singletonHost', preset.host);
                        updateNetworkConfig('singletonPort', preset.port);
                        updateNetworkConfig('singletonSsl', preset.useSsl);
                      }}
                      className="px-2 py-1 text-xs rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pool Config */}
          {mode === 'pool' && (
            <div className="space-y-4">
              {/* Pool Settings */}
              <div className="p-4 surface-muted rounded-xl">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Min Connections</label>
                    <input
                      type="number"
                      value={poolMin}
                      onChange={(e) => updateNetworkConfig('poolMin', parseInt(e.target.value) || 1)}
                      min={1}
                      max={poolMax}
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Max Connections</label>
                    <input
                      type="number"
                      value={poolMax}
                      onChange={(e) => updateNetworkConfig('poolMax', parseInt(e.target.value) || 5)}
                      min={poolMin}
                      max={20}
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Strategy</label>
                    <select
                      value={poolLoadBalancing}
                      onChange={(e) => updateNetworkConfig('poolLoadBalancing', e.target.value)}
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                    >
                      <option value="round_robin">Round Robin</option>
                      <option value="least_connections">Least Connections</option>
                      <option value="failover_only">Failover Only</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Server List */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                    Pool Servers ({servers.length})
                  </label>
                  <Button variant="secondary" size="sm" onClick={() => setIsAddingServer(true)}>
                    <Plus className="w-4 h-4 mr-1" /> Add Server
                  </Button>
                </div>

                {servers.length === 0 && !isAddingServer && (
                  <div className="p-4 text-center text-sanctuary-500 surface-muted rounded-xl">
                    <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No servers configured</p>
                    <div className="flex flex-wrap justify-center gap-2 mt-3">
                      {presets.map((preset) => (
                        <button
                          key={preset.name}
                          onClick={() => handleAddPreset(preset)}
                          className="px-2 py-1 text-xs rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700"
                        >
                          + {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {servers.length > 0 && (
                  <div className="space-y-2">
                    {servers.map((server, index) => (
                      <div
                        key={server.id}
                        className={`p-3 rounded-xl border ${
                          server.enabled
                            ? 'surface-muted border-sanctuary-200 dark:border-sanctuary-700'
                            : 'surface-secondary border-sanctuary-100 dark:border-sanctuary-800 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {/* Health Status Indicator */}
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              serverTestStatus[server.id] === 'success' ? 'bg-emerald-500' :
                              serverTestStatus[server.id] === 'error' ? 'bg-rose-500' :
                              server.isHealthy ? 'bg-emerald-500' :
                              server.isHealthy === false ? 'bg-rose-500' : 'bg-sanctuary-400'
                            }`} />
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate">
                                  {server.label}
                                </span>
                                <span className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 ${
                                  server.useSsl ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
                                }`}>
                                  {server.useSsl ? 'SSL' : 'TCP'}
                                </span>
                              </div>
                              <span className="text-xs text-sanctuary-500">{server.host}:{server.port}</span>
                              {/* Health History Blocks & Stats */}
                              <div className="flex items-center space-x-2 mt-1">
                                {/* Health History Blocks - 10 blocks showing recent health */}
                                <div className="flex items-center space-x-0.5" title={
                                  server.lastHealthCheck
                                    ? `Last check: ${new Date(server.lastHealthCheck).toLocaleTimeString()}${server.healthCheckFails ? ` | ${server.healthCheckFails} consecutive fail${server.healthCheckFails > 1 ? 's' : ''}` : ''}`
                                    : 'No health checks yet'
                                }>
                                  {Array.from({ length: 10 }).map((_, i) => {
                                    // Calculate health block color based on fail count
                                    // Most recent blocks (lower index) show current state
                                    const failCount = server.healthCheckFails ?? 0;
                                    const isFailedBlock = i < failCount;
                                    const hasHealthData = server.lastHealthCheck !== null && server.lastHealthCheck !== undefined;

                                    return (
                                      <div
                                        key={i}
                                        className={`w-1.5 h-3 rounded-sm ${
                                          !hasHealthData ? 'bg-sanctuary-300 dark:bg-sanctuary-600' :
                                          isFailedBlock ? 'bg-rose-400 dark:bg-rose-500' :
                                          'bg-emerald-400 dark:bg-emerald-500'
                                        }`}
                                      />
                                    );
                                  })}
                                </div>
                                {/* Last check time */}
                                {server.lastHealthCheck && (
                                  <span className="text-[10px] text-sanctuary-400">
                                    {new Date(server.lastHealthCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1">
                            {/* Manual Test Status Icons */}
                            {serverTestStatus[server.id] === 'success' && (
                              <CheckCircle className="w-4 h-4 text-emerald-500" />
                            )}
                            {serverTestStatus[server.id] === 'error' && (
                              <XCircle className="w-4 h-4 text-rose-500" />
                            )}
                            <button
                              onClick={() => handleTestServer(server)}
                              className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
                              disabled={serverTestStatus[server.id] === 'testing'}
                              title="Test connection"
                            >
                              {serverTestStatus[server.id] === 'testing' ? (
                                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                              ) : (
                                <RefreshCw className="w-4 h-4 text-sanctuary-400" />
                              )}
                            </button>
                            <button
                              onClick={() => handleMoveServer(server.id, 'up')}
                              disabled={index === 0}
                              className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 disabled:opacity-30"
                            >
                              <ChevronUp className="w-4 h-4 text-sanctuary-400" />
                            </button>
                            <button
                              onClick={() => handleMoveServer(server.id, 'down')}
                              disabled={index === servers.length - 1}
                              className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 disabled:opacity-30"
                            >
                              <ChevronDown className="w-4 h-4 text-sanctuary-400" />
                            </button>
                            <button
                              onClick={() => handleToggleServer(server)}
                              className="p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
                            >
                              {server.enabled ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                              ) : (
                                <XCircle className="w-4 h-4 text-sanctuary-400" />
                              )}
                            </button>
                            <button
                              onClick={() => handleDeleteServer(server.id)}
                              className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30"
                              disabled={serverActionLoading === server.id}
                            >
                              {serverActionLoading === server.id ? (
                                <Loader2 className="w-4 h-4 animate-spin text-sanctuary-400" />
                              ) : (
                                <Trash2 className="w-4 h-4 text-red-500" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Server Form */}
                {isAddingServer && (
                  <div className="mt-3 p-4 surface-muted rounded-xl space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Label</label>
                        <input
                          type="text"
                          value={newServer.label}
                          onChange={(e) => setNewServer({ ...newServer, label: e.target.value })}
                          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                          placeholder="My Server"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Host</label>
                        <input
                          type="text"
                          value={newServer.host}
                          onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                          placeholder="electrum.example.com"
                        />
                      </div>
                      <div className="flex space-x-2">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-sanctuary-500 mb-1">Port</label>
                          <input
                            type="number"
                            value={newServer.port}
                            onChange={(e) => setNewServer({ ...newServer, port: parseInt(e.target.value) || 50002 })}
                            className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-sanctuary-500 mb-1">SSL</label>
                          <button
                            onClick={() => setNewServer({ ...newServer, useSsl: !newServer.useSsl })}
                            className={`px-3 py-2 rounded-lg text-sm ${
                              newServer.useSsl ? `${colors.accent}` : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
                            }`}
                          >
                            {newServer.useSsl ? 'SSL' : 'TCP'}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {presets.map((preset) => (
                          <button
                            key={preset.name}
                            onClick={() => handleAddPreset(preset)}
                            className="px-2 py-1 text-xs rounded bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500 hover:bg-sanctuary-200"
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>
                      <div className="flex space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => setIsAddingServer(false)}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleAddServer}
                          disabled={!newServer.label || !newServer.host || serverActionLoading === 'add'}
                        >
                          {serverActionLoading === 'add' ? (
                            <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Adding</>
                          ) : (
                            'Add Server'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
