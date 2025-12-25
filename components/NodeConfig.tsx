import React, { useState, useEffect } from 'react';
import { NodeConfig as NodeConfigType, ElectrumServer } from '../types';
import { Button } from './ui/Button';
import {
  Check,
  AlertCircle,
  Link as LinkIcon,
  CheckCircle,
  XCircle,
  Gauge,
  Shield,
  RefreshCw,
  Loader2,
  Globe,
} from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { createLogger } from '../utils/logger';
import { NetworkConnectionCard } from './NetworkConnectionCard';

const log = createLogger('NodeConfig');

export const NodeConfig: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [nodeConfig, setNodeConfig] = useState<NodeConfigType | null>(null);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [nodeSaveSuccess, setNodeSaveSuccess] = useState(false);
  const [nodeSaveError, setNodeSaveError] = useState<string | null>(null);

  // All electrum servers (will be filtered by network for each card)
  const [allServers, setAllServers] = useState<ElectrumServer[]>([]);

  // Proxy test state
  const [proxyTestStatus, setProxyTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [proxyTestMessage, setProxyTestMessage] = useState<string>('');

  // Tor container state
  const [torContainerStatus, setTorContainerStatus] = useState<adminApi.TorContainerStatus | null>(null);
  const [isTorContainerLoading, setIsTorContainerLoading] = useState(false);
  const [torContainerMessage, setTorContainerMessage] = useState<string>('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [nc, serverList, torStatus] = await Promise.all([
          adminApi.getNodeConfig(),
          adminApi.getElectrumServers().catch(() => []),
          adminApi.getTorContainerStatus().catch(() => null),
        ]);
        setNodeConfig(nc);
        setAllServers(serverList);
        if (torStatus) setTorContainerStatus(torStatus);
      } catch (error) {
        log.error('Failed to load data', { error });
        // Set default node config if API call fails
        setNodeConfig({
          type: 'electrum',
          explorerUrl: 'https://mempool.space',
          feeEstimatorUrl: 'https://mempool.space',
          mempoolEstimator: 'mempool_space',
          // Per-network settings (mainnet defaults)
          mainnetMode: 'pool',
          mainnetSingletonHost: 'electrum.blockstream.info',
          mainnetSingletonPort: 50002,
          mainnetSingletonSsl: true,
          mainnetPoolMin: 1,
          mainnetPoolMax: 5,
          mainnetPoolLoadBalancing: 'round_robin',
          // Testnet defaults
          testnetEnabled: false,
          testnetMode: 'singleton',
          testnetSingletonHost: 'electrum.blockstream.info',
          testnetSingletonPort: 60002,
          testnetSingletonSsl: true,
          testnetPoolMin: 1,
          testnetPoolMax: 3,
          testnetPoolLoadBalancing: 'round_robin',
          // Signet defaults
          signetEnabled: false,
          signetMode: 'singleton',
          signetSingletonHost: 'electrum.mutinynet.com',
          signetSingletonPort: 50002,
          signetSingletonSsl: true,
          signetPoolMin: 1,
          signetPoolMax: 3,
          signetPoolLoadBalancing: 'round_robin',
        });
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleSaveNodeConfig = async () => {
    if (!nodeConfig) return;

    setIsSavingNode(true);
    setNodeSaveError(null);
    setNodeSaveSuccess(false);

    try {
      await adminApi.updateNodeConfig(nodeConfig);
      setNodeSaveSuccess(true);
      setTimeout(() => setNodeSaveSuccess(false), 3000);
    } catch (error) {
      log.error('Failed to save node config', { error });
      setNodeSaveError('Failed to save node configuration');
    } finally {
      setIsSavingNode(false);
    }
  };

  // Get the effective fee estimator URL for display
  const getEffectiveFeeUrl = () => {
    return nodeConfig?.feeEstimatorUrl || nodeConfig?.explorerUrl || 'https://mempool.space';
  };

  // Test connection handler for NetworkConnectionCard
  const handleTestConnection = async (host: string, port: number, ssl: boolean) => {
    try {
      const result = await adminApi.testElectrumConnection({
        host,
        port,
        useSsl: ssl,
      });
      return result;
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Connection failed',
      };
    }
  };

  // Get servers filtered by network
  const getServersForNetwork = (network: 'mainnet' | 'testnet' | 'signet') => {
    return allServers.filter(s => s.network === network).sort((a, b) => a.priority - b.priority);
  };

  // Update servers for a specific network
  const handleServersChange = (network: 'mainnet' | 'testnet' | 'signet', servers: ElectrumServer[]) => {
    setAllServers(prev => [
      ...prev.filter(s => s.network !== network),
      ...servers,
    ]);
  };

  const handleTestProxy = async () => {
    if (!nodeConfig?.proxyHost || !nodeConfig?.proxyPort) return;

    setProxyTestStatus('testing');
    setProxyTestMessage('Verifying Tor connection via .onion address...');

    try {
      const result = await adminApi.testProxy({
        host: nodeConfig.proxyHost,
        port: nodeConfig.proxyPort,
        username: nodeConfig.proxyUsername,
        password: nodeConfig.proxyPassword,
      });

      if (result.success) {
        setProxyTestStatus('success');
        setProxyTestMessage(result.message || 'Proxy connection successful');
      } else {
        setProxyTestStatus('error');
        setProxyTestMessage(result.message || 'Proxy connection failed');
      }
    } catch (error: any) {
      log.error('Proxy test error', { error });
      setProxyTestStatus('error');
      setProxyTestMessage(error.response?.data?.message || error.message || 'Failed to test proxy');
    }

    // Clear status after 10 seconds
    setTimeout(() => {
      setProxyTestStatus('idle');
      setProxyTestMessage('');
    }, 10000);
  };

  const handleProxyPreset = (preset: 'tor' | 'tor-browser' | 'tor-container') => {
    if (!nodeConfig) return;
    if (preset === 'tor-container') {
      setNodeConfig({
        ...nodeConfig,
        proxyEnabled: true,
        proxyHost: 'tor',
        proxyPort: 9050,
        proxyUsername: undefined,
        proxyPassword: undefined,
      });
    } else {
      const port = preset === 'tor' ? 9050 : 9150;
      setNodeConfig({
        ...nodeConfig,
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: port,
        proxyUsername: undefined,
        proxyPassword: undefined,
      });
    }
  };

  const handleTorContainerToggle = async () => {
    if (!torContainerStatus) return;

    setIsTorContainerLoading(true);
    setTorContainerMessage('');

    try {
      if (torContainerStatus.running) {
        const result = await adminApi.stopTorContainer();
        setTorContainerMessage(result.message);
        if (result.success) {
          setTorContainerStatus({ ...torContainerStatus, running: false, status: 'exited' });
        }
      } else {
        setTorContainerMessage(torContainerStatus.exists ? 'Starting Tor...' : 'Installing Tor container...');
        const result = await adminApi.startTorContainer();
        setTorContainerMessage(result.message);
        if (result.success) {
          setTorContainerStatus({ ...torContainerStatus, exists: true, running: true, status: 'running' });
        }
      }
    } catch (error: any) {
      log.error('Tor container toggle error', { error });
      setTorContainerMessage(error.message || 'Failed to toggle Tor container');
    } finally {
      setIsTorContainerLoading(false);
      setTimeout(async () => {
        const status = await adminApi.getTorContainerStatus().catch(() => null);
        if (status) setTorContainerStatus(status);
      }, 2000);
    }
  };

  const refreshTorContainerStatus = async () => {
    try {
      const status = await adminApi.getTorContainerStatus();
      setTorContainerStatus(status);
    } catch (error) {
      log.error('Failed to refresh Tor container status', { error });
    }
  };

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading node configuration...</div>;

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Node Configuration</h2>
        <p className="text-sanctuary-500">Configure network settings for the Bitcoin backend</p>
      </div>

      {/* Status Messages */}
      {nodeConfig && (nodeSaveError || nodeSaveSuccess) && (
        <div className="space-y-3">
          {nodeSaveError && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start animate-fade-in">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800 dark:text-red-300">{nodeSaveError}</span>
            </div>
          )}

          {nodeSaveSuccess && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl flex items-start animate-fade-in">
              <Check className="w-5 h-5 text-green-600 dark:text-green-400 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-green-800 dark:text-green-300">Node configuration saved successfully</span>
            </div>
          )}
        </div>
      )}

      {nodeConfig && (
        <div className="space-y-6">
          {/* Section 1: Block Explorer */}
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-sanctuary-50/50 dark:bg-sanctuary-800/30">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                  <LinkIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Block Explorer</h3>
                  <p className="text-xs text-sanctuary-500">External service for viewing transactions and blocks</p>
                </div>
              </div>
            </div>

            <div className="p-5">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Explorer URL</label>
                <input
                  type="text"
                  value={nodeConfig.explorerUrl || ''}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, explorerUrl: e.target.value })}
                  placeholder="https://mempool.space"
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
                <div className="flex space-x-2 mt-3">
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, explorerUrl: 'https://mempool.space' })}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      nodeConfig.explorerUrl === 'https://mempool.space'
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                        : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    mempool.space
                  </button>
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, explorerUrl: 'https://blockstream.info' })}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      nodeConfig.explorerUrl === 'https://blockstream.info'
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                        : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    blockstream.info
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Fee & Block Confirmation Estimator */}
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-sanctuary-50/50 dark:bg-sanctuary-800/30">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400">
                  <Gauge className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Fee & Block Confirmation Estimator</h3>
                  <p className="text-xs text-sanctuary-500">API and algorithm for fee rates and block confirmation predictions</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Fee Estimator Source Toggle */}
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Fee Estimation Source</label>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space' })}
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                      nodeConfig.feeEstimatorUrl
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                        : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    <div className="font-medium">Mempool API</div>
                    <div className="text-[10px] opacity-70">mempool.space compatible</div>
                  </button>
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: '' })}
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                      !nodeConfig.feeEstimatorUrl
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                        : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    <div className="font-medium">Electrum Server</div>
                    <div className="text-[10px] opacity-70">From node connection</div>
                  </button>
                </div>
              </div>

              {/* Fee Estimator URL - only shown when using Mempool API */}
              {nodeConfig.feeEstimatorUrl !== '' && nodeConfig.feeEstimatorUrl !== undefined && (
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Mempool API URL</label>
                  <input
                    type="text"
                    value={nodeConfig.feeEstimatorUrl || 'https://mempool.space'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: e.target.value })}
                    placeholder="https://mempool.space"
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  />
                  <div className="flex space-x-2 mt-2">
                    <button
                      onClick={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: 'https://mempool.space' })}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        nodeConfig.feeEstimatorUrl === 'https://mempool.space'
                          ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                          : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                      }`}
                    >
                      mempool.space
                    </button>
                  </div>
                  <p className="text-xs text-sanctuary-400 mt-2">
                    Enter custom mempool.space instance URL or use default
                  </p>
                </div>
              )}

              {!nodeConfig.feeEstimatorUrl && (
                <p className="text-xs text-sanctuary-400 p-3 surface-secondary rounded-lg">
                  Fee estimates will be fetched from the Electrum server configured below. Note: Electrum provides less detailed fee data than mempool.space.
                </p>
              )}

              <div className="border-t border-sanctuary-100 dark:border-sanctuary-800" />

              {/* Block Confirmation Algorithm */}
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Block Confirmation Algorithm</label>
                <select
                  value={nodeConfig.mempoolEstimator || 'mempool_space'}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, mempoolEstimator: e.target.value as 'simple' | 'mempool_space' })}
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="mempool_space">mempool.space (Projected Blocks)</option>
                  <option value="simple">Simple (Fee Buckets)</option>
                </select>
                <div className="mt-3 p-3 surface-secondary rounded-lg">
                  {nodeConfig.mempoolEstimator === 'mempool_space' || !nodeConfig.mempoolEstimator ? (
                    <div className="space-y-2">
                      <p className="text-xs text-sanctuary-600 dark:text-sanctuary-300">
                        <strong>Projected Blocks:</strong> Sorts all mempool transactions by fee rate and simulates which transactions miners will include in each block. Most accurate.
                      </p>
                      <p className="text-xs text-sanctuary-400">
                        Uses API: {getEffectiveFeeUrl()}/api/v1/fees/mempool-blocks
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-sanctuary-600 dark:text-sanctuary-300">
                        <strong>Fee Buckets:</strong> Uses fee rate thresholds to estimate confirmation time. Faster but less accurate when mempool is congested.
                      </p>
                      <p className="text-xs text-sanctuary-400">
                        Example: "Next block = 2+ sat/vB, +2 blocks = 1+ sat/vB"
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Network Connections (Per-Network Cards) */}
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-sanctuary-50/50 dark:bg-sanctuary-800/30">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Network Connections</h3>
                  <p className="text-xs text-sanctuary-500">Configure Electrum server connections for each Bitcoin network</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Mainnet */}
              <NetworkConnectionCard
                network="mainnet"
                config={nodeConfig}
                servers={getServersForNetwork('mainnet')}
                onConfigChange={(updates) => setNodeConfig({ ...nodeConfig, ...updates })}
                onServersChange={(servers) => handleServersChange('mainnet', servers)}
                onTestConnection={handleTestConnection}
              />

              {/* Testnet */}
              <NetworkConnectionCard
                network="testnet"
                config={nodeConfig}
                servers={getServersForNetwork('testnet')}
                onConfigChange={(updates) => setNodeConfig({ ...nodeConfig, ...updates })}
                onServersChange={(servers) => handleServersChange('testnet', servers)}
                onTestConnection={handleTestConnection}
              />

              {/* Signet */}
              <NetworkConnectionCard
                network="signet"
                config={nodeConfig}
                servers={getServersForNetwork('signet')}
                onConfigChange={(updates) => setNodeConfig({ ...nodeConfig, ...updates })}
                onServersChange={(servers) => handleServersChange('signet', servers)}
                onTestConnection={handleTestConnection}
              />
            </div>
          </div>

          {/* Section 4: Proxy / Tor Settings */}
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-sanctuary-50/50 dark:bg-sanctuary-800/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${nodeConfig.proxyEnabled ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-400'}`}>
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Proxy / Tor</h3>
                    <p className="text-xs text-sanctuary-500">Route all Electrum connections through SOCKS5 proxy for privacy</p>
                  </div>
                </div>
                <button
                  onClick={() => setNodeConfig({ ...nodeConfig, proxyEnabled: !nodeConfig.proxyEnabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${nodeConfig.proxyEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${nodeConfig.proxyEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            {nodeConfig.proxyEnabled && (
              <div className="p-5 space-y-5">
                {/* Bundled Tor Container */}
                {torContainerStatus?.available && (
                  <div className="p-4 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Shield className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                        <div>
                          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Bundled Tor Container</span>
                          <p className="text-xs text-sanctuary-500">
                            {!torContainerStatus.exists
                              ? 'Not installed - toggle to install'
                              : torContainerStatus.running
                                ? 'Running and ready to use'
                                : 'Stopped'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={refreshTorContainerStatus}
                          className="p-1.5 hover:bg-violet-100 dark:hover:bg-violet-900/30 rounded transition-colors"
                          title="Refresh status"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 text-sanctuary-500 ${isTorContainerLoading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={handleTorContainerToggle}
                          disabled={isTorContainerLoading}
                          title={!torContainerStatus.exists ? 'Click to install and start Tor container' : undefined}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:opacity-50 ${
                            torContainerStatus.running ? 'bg-violet-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            torContainerStatus.running ? 'translate-x-6' : 'translate-x-1'
                          }`}>
                            {isTorContainerLoading && (
                              <Loader2 className="w-4 h-4 text-violet-600 animate-spin" />
                            )}
                          </span>
                        </button>
                      </div>
                    </div>

                    {torContainerStatus.exists && torContainerStatus.running && (
                      <div className="mt-3 pt-3 border-t border-violet-200 dark:border-violet-800">
                        <button
                          onClick={() => handleProxyPreset('tor-container')}
                          className={`w-full text-left px-3 py-2 text-xs rounded-lg border transition-colors ${
                            nodeConfig.proxyHost === 'tor' && nodeConfig.proxyPort === 9050
                              ? 'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
                              : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                          }`}
                        >
                          <div className="font-medium">Use Tor Container</div>
                          <div className="text-[10px] text-sanctuary-500 font-mono">tor:9050 (internal network)</div>
                        </button>
                      </div>
                    )}

                    {torContainerMessage && (
                      <p className={`text-xs mt-2 ${
                        torContainerMessage.includes('success') || torContainerMessage.includes('started') || torContainerMessage.includes('stopped')
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        {torContainerMessage}
                      </p>
                    )}
                  </div>
                )}

                {/* Quick Presets */}
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
                    {torContainerStatus?.available ? 'External Tor (Optional)' : 'Quick Setup'}
                  </label>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleProxyPreset('tor')}
                      className={`flex-1 text-left px-3 py-2 text-xs rounded-lg border transition-colors ${
                        nodeConfig.proxyHost === '127.0.0.1' && nodeConfig.proxyPort === 9050
                          ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
                          : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                      }`}
                    >
                      <div className="font-medium">Tor Daemon</div>
                      <div className="text-[10px] text-sanctuary-500 font-mono">127.0.0.1:9050</div>
                    </button>
                    <button
                      onClick={() => handleProxyPreset('tor-browser')}
                      className={`flex-1 text-left px-3 py-2 text-xs rounded-lg border transition-colors ${
                        nodeConfig.proxyHost === '127.0.0.1' && nodeConfig.proxyPort === 9150
                          ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
                          : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                      }`}
                    >
                      <div className="font-medium">Tor Browser</div>
                      <div className="text-[10px] text-sanctuary-500 font-mono">127.0.0.1:9150</div>
                    </button>
                  </div>
                  <p className="text-xs text-sanctuary-400 mt-2">
                    {torContainerStatus?.available
                      ? 'Use these presets if you have Tor running on your host machine instead of using the bundled container.'
                      : 'Select a preset or configure manually below. Tor must be running separately.'}
                  </p>
                </div>

                <div className="border-t border-sanctuary-100 dark:border-sanctuary-800" />

                {/* Host & Port */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Proxy Host</label>
                    <input
                      type="text"
                      value={nodeConfig.proxyHost || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, proxyHost: e.target.value })}
                      placeholder="127.0.0.1"
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Port</label>
                    <input
                      type="number"
                      value={nodeConfig.proxyPort || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, proxyPort: parseInt(e.target.value) || undefined })}
                      placeholder="9050"
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                </div>

                {/* Optional Authentication */}
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
                    Authentication <span className="font-normal text-sanctuary-400">(optional)</span>
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <input
                      type="text"
                      value={nodeConfig.proxyUsername || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, proxyUsername: e.target.value || undefined })}
                      placeholder="Username"
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    />
                    <input
                      type="password"
                      value={nodeConfig.proxyPassword || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, proxyPassword: e.target.value || undefined })}
                      placeholder="Password"
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    />
                  </div>
                  <p className="text-xs text-sanctuary-400 mt-2">
                    Most Tor configurations don't require authentication. Only set if your proxy requires it.
                  </p>
                </div>

                {/* Test Result */}
                {proxyTestMessage && proxyTestStatus !== 'idle' && (
                  <>
                    <div className="border-t border-sanctuary-100 dark:border-sanctuary-800" />
                    <div className={`p-4 rounded-xl border animate-fade-in ${
                      proxyTestStatus === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                        : proxyTestStatus === 'error'
                        ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                        : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    }`}>
                      <div className="flex items-start">
                        {proxyTestStatus === 'success' && <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mr-2 flex-shrink-0 mt-0.5" />}
                        {proxyTestStatus === 'error' && <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 mr-2 flex-shrink-0 mt-0.5" />}
                        {proxyTestStatus === 'testing' && <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2 flex-shrink-0 mt-0.5 animate-pulse" />}
                        <span className={`text-sm font-medium ${
                          proxyTestStatus === 'success'
                            ? 'text-emerald-800 dark:text-emerald-300'
                            : proxyTestStatus === 'error'
                            ? 'text-rose-800 dark:text-rose-300'
                            : 'text-blue-800 dark:text-blue-300'
                        }`}>
                          {proxyTestMessage}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {/* Test Button */}
                <div className="border-t border-sanctuary-100 dark:border-sanctuary-800" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleTestProxy}
                  isLoading={proxyTestStatus === 'testing'}
                  disabled={proxyTestStatus === 'testing' || !nodeConfig.proxyHost || !nodeConfig.proxyPort}
                  className="w-full"
                >
                  Verify Tor Connection
                </Button>
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button onClick={handleSaveNodeConfig} isLoading={isSavingNode} size="lg">
              Save All Settings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
