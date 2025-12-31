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
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import * as adminApi from '../src/api/admin';
import * as bitcoinApi from '../src/api/bitcoin';
import { createLogger } from '../utils/logger';
import { NetworkConnectionCard } from './NetworkConnectionCard';

const log = createLogger('NodeConfig');

type SectionId = 'external' | 'networks' | 'proxy';
type NetworkTab = 'mainnet' | 'testnet' | 'signet';

export const NodeConfig: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [nodeConfig, setNodeConfig] = useState<NodeConfigType | null>(null);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [nodeSaveSuccess, setNodeSaveSuccess] = useState(false);
  const [nodeSaveError, setNodeSaveError] = useState<string | null>(null);

  // All electrum servers (will be filtered by network for each card)
  const [allServers, setAllServers] = useState<ElectrumServer[]>([]);

  // Collapsible sections - only one open at a time
  const [expandedSection, setExpandedSection] = useState<SectionId | null>(null);

  // Network tabs
  const [activeNetworkTab, setActiveNetworkTab] = useState<NetworkTab>('mainnet');

  // Proxy test state
  const [proxyTestStatus, setProxyTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [proxyTestMessage, setProxyTestMessage] = useState<string>('');

  // Tor container state
  const [torContainerStatus, setTorContainerStatus] = useState<adminApi.TorContainerStatus | null>(null);
  const [isTorContainerLoading, setIsTorContainerLoading] = useState(false);
  const [torContainerMessage, setTorContainerMessage] = useState<string>('');

  // Pool stats for health history
  const [poolStats, setPoolStats] = useState<bitcoinApi.PoolStats | null>(null);

  // Show custom proxy fields
  const [showCustomProxy, setShowCustomProxy] = useState(false);

  // Fetch pool stats for health history
  const fetchPoolStats = async () => {
    try {
      const status = await bitcoinApi.getStatus();
      if (status.pool?.stats) {
        setPoolStats(status.pool.stats);
      }
    } catch (error) {
      // Silently fail - pool stats are optional enhancement
      log.debug('Failed to load pool stats', { error });
    }
  };

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
        // Show custom proxy fields if not using bundled Tor
        if (nc?.proxyEnabled && nc.proxyHost !== 'tor') {
          setShowCustomProxy(true);
        }
        // Also fetch pool stats
        fetchPoolStats();
      } catch (error) {
        log.error('Failed to load data', { error });
        // Set default node config if API call fails
        setNodeConfig({
          type: 'electrum',
          explorerUrl: 'https://mempool.space',
          feeEstimatorUrl: 'https://mempool.space',
          mempoolEstimator: 'mempool_space',
          mainnetMode: 'pool',
          mainnetSingletonHost: 'electrum.blockstream.info',
          mainnetSingletonPort: 50002,
          mainnetSingletonSsl: true,
          mainnetPoolMin: 1,
          mainnetPoolMax: 5,
          mainnetPoolLoadBalancing: 'round_robin',
          testnetEnabled: false,
          testnetMode: 'singleton',
          testnetSingletonHost: 'electrum.blockstream.info',
          testnetSingletonPort: 60002,
          testnetSingletonSsl: true,
          testnetPoolMin: 1,
          testnetPoolMax: 3,
          testnetPoolLoadBalancing: 'round_robin',
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
      setShowCustomProxy(false);
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
      setShowCustomProxy(true);
    }
  };

  const handleTorContainerToggle = async () => {
    if (!torContainerStatus) return;

    setIsTorContainerLoading(true);
    setTorContainerMessage('');

    try {
      if (torContainerStatus.running) {
        // Stopping Tor - warn about bootstrap time
        const result = await adminApi.stopTorContainer();
        if (result.success) {
          setTorContainerMessage('Tor stopped. Re-enabling will take 10-30s to bootstrap.');
          setTorContainerStatus({ ...torContainerStatus, running: false, status: 'exited' });
          // If we were using bundled Tor, disable proxy
          if (nodeConfig?.proxyHost === 'tor') {
            setNodeConfig({ ...nodeConfig, proxyEnabled: false, proxyHost: undefined, proxyPort: undefined });
          }
        } else {
          setTorContainerMessage(result.message);
        }
      } else {
        setTorContainerMessage(torContainerStatus.exists ? 'Starting Tor (10-30s)...' : 'Installing Tor (may take a minute)...');
        const result = await adminApi.startTorContainer();
        if (result.success) {
          // Wait a moment for Tor to bootstrap
          setTorContainerMessage('Bootstrapping Tor network...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          setTorContainerStatus({ ...torContainerStatus, exists: true, running: true, status: 'running' });
          setTorContainerMessage('Tor ready');
        } else {
          setTorContainerMessage(result.message);
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

  const toggleSection = (section: SectionId) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  // Generate summaries for collapsed sections
  const getExternalServicesSummary = () => {
    if (!nodeConfig) return '';
    const explorer = nodeConfig.explorerUrl?.replace('https://', '') || 'mempool.space';
    const feeSource = nodeConfig.feeEstimatorUrl ? 'Mempool API' : 'Electrum';
    return `${explorer} • ${feeSource}`;
  };

  const getNetworksSummary = () => {
    const mainnetServers = getServersForNetwork('mainnet').length;
    const testnetEnabled = nodeConfig?.testnetEnabled;
    const signetEnabled = nodeConfig?.signetEnabled;
    const parts = [`Mainnet (${mainnetServers})`];
    if (testnetEnabled) parts.push('Testnet');
    if (signetEnabled) parts.push('Signet');
    return parts.join(' • ');
  };

  const getProxySummary = () => {
    if (!nodeConfig?.proxyEnabled) return 'Disabled';
    if (nodeConfig.proxyHost === 'tor') return 'Bundled Tor';
    return `${nodeConfig.proxyHost}:${nodeConfig.proxyPort}`;
  };

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading node configuration...</div>;

  return (
    <div className="space-y-4 animate-fade-in pb-12">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Node Configuration</h2>
          <p className="text-sm text-sanctuary-500">Configure network settings for the Bitcoin backend</p>
        </div>
        <Button onClick={handleSaveNodeConfig} isLoading={isSavingNode}>
          Save All Settings
        </Button>
      </div>

      {/* Status Messages */}
      {nodeConfig && (nodeSaveError || nodeSaveSuccess) && (
        <div className="space-y-2">
          {nodeSaveError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center animate-fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mr-2 flex-shrink-0" />
              <span className="text-sm text-red-800 dark:text-red-300">{nodeSaveError}</span>
            </div>
          )}
          {nodeSaveSuccess && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl flex items-center animate-fade-in">
              <Check className="w-4 h-4 text-green-600 dark:text-green-400 mr-2 flex-shrink-0" />
              <span className="text-sm text-green-800 dark:text-green-300">Node configuration saved successfully</span>
            </div>
          )}
        </div>
      )}

      {nodeConfig && (
        <div className="space-y-3">
          {/* Section 1: External Services (merged Block Explorer + Fee Estimator) */}
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <button
              onClick={() => toggleSection('external')}
              className="w-full p-4 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                  <ExternalLink className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">External Services</h3>
                  <p className="text-xs text-sanctuary-500">{getExternalServicesSummary()}</p>
                </div>
              </div>
              <ChevronRight className={`w-5 h-5 text-sanctuary-400 transition-transform ${expandedSection === 'external' ? 'rotate-90' : ''}`} />
            </button>

            {expandedSection === 'external' && (
              <div className="px-4 pb-4 space-y-4 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
                {/* Block Explorer */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-sanctuary-500 mb-1">Block Explorer</label>
                    <input
                      type="text"
                      value={nodeConfig.explorerUrl || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, explorerUrl: e.target.value })}
                      placeholder="https://mempool.space"
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                  <div className="flex gap-1 pt-5">
                    {['mempool.space', 'blockstream.info'].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setNodeConfig({ ...nodeConfig, explorerUrl: `https://${preset}` })}
                        className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                          nodeConfig.explorerUrl === `https://${preset}`
                            ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                            : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fee Estimation Source - inline radio style */}
                <div>
                  <label className="block text-xs font-medium text-sanctuary-500 mb-2">Fee Estimation</label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="feeSource"
                        checked={!!nodeConfig.feeEstimatorUrl}
                        onChange={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space' })}
                        className="w-4 h-4 text-primary-600"
                      />
                      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Mempool API</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="feeSource"
                        checked={!nodeConfig.feeEstimatorUrl}
                        onChange={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: '' })}
                        className="w-4 h-4 text-primary-600"
                      />
                      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Electrum Server</span>
                    </label>
                  </div>
                </div>

                {/* Fee Estimator URL - only shown when using Mempool API */}
                {nodeConfig.feeEstimatorUrl && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-sanctuary-500 mb-1">Mempool API URL</label>
                      <input
                        type="text"
                        value={nodeConfig.feeEstimatorUrl}
                        onChange={(e) => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: e.target.value })}
                        placeholder="https://mempool.space"
                        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* Block Confirmation Algorithm - compact dropdown */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                      Block Confirmation Algorithm
                      <span className="ml-1 text-sanctuary-400" title="Projected Blocks: simulates miner block selection. Simple: uses fee rate buckets.">(?)</span>
                    </label>
                    <select
                      value={nodeConfig.mempoolEstimator || 'mempool_space'}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, mempoolEstimator: e.target.value as 'simple' | 'mempool_space' })}
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    >
                      <option value="mempool_space">Projected Blocks (Accurate)</option>
                      <option value="simple">Simple Fee Buckets (Fast)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Network Connections (Tabbed) */}
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <button
              onClick={() => toggleSection('networks')}
              className="w-full p-4 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                  <Globe className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Network Connections</h3>
                  <p className="text-xs text-sanctuary-500">{getNetworksSummary()}</p>
                </div>
              </div>
              <ChevronRight className={`w-5 h-5 text-sanctuary-400 transition-transform ${expandedSection === 'networks' ? 'rotate-90' : ''}`} />
            </button>

            {expandedSection === 'networks' && (
              <div className="border-t border-sanctuary-100 dark:border-sanctuary-800">
                {/* Network Tabs */}
                <div className="flex border-b border-sanctuary-100 dark:border-sanctuary-800">
                  {(['mainnet', 'testnet', 'signet'] as const).map((network) => {
                    const isEnabled = network === 'mainnet' ||
                      (network === 'testnet' && nodeConfig.testnetEnabled) ||
                      (network === 'signet' && nodeConfig.signetEnabled);
                    const serverCount = getServersForNetwork(network).length;
                    const networkColors: Record<string, string> = {
                      mainnet: 'border-mainnet-500 text-mainnet-600 dark:text-mainnet-400',
                      testnet: 'border-testnet-500 text-testnet-600 dark:text-testnet-400',
                      signet: 'border-signet-500 text-signet-600 dark:text-signet-400',
                    };

                    return (
                      <button
                        key={network}
                        onClick={() => setActiveNetworkTab(network)}
                        className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                          activeNetworkTab === network
                            ? networkColors[network]
                            : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                        }`}
                      >
                        <span className="capitalize">{network}</span>
                        {isEnabled && (
                          <span className="ml-1.5 text-xs text-sanctuary-400">
                            {serverCount > 0 ? `(${serverCount})` : ''}
                          </span>
                        )}
                        {!isEnabled && (
                          <span className="ml-1.5 text-xs text-sanctuary-400">(off)</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Active Network Card */}
                <div className="p-4">
                  <NetworkConnectionCard
                    key={activeNetworkTab}
                    network={activeNetworkTab}
                    config={nodeConfig}
                    servers={getServersForNetwork(activeNetworkTab)}
                    poolStats={poolStats}
                    onConfigChange={(updates) => setNodeConfig({ ...nodeConfig, ...updates })}
                    onServersChange={(servers) => handleServersChange(activeNetworkTab, servers)}
                    onTestConnection={handleTestConnection}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Proxy / Tor */}
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <button
              onClick={() => toggleSection('proxy')}
              className="w-full p-4 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${nodeConfig.proxyEnabled ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-400'}`}>
                  <Shield className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Proxy / Tor</h3>
                  <p className="text-xs text-sanctuary-500">{getProxySummary()}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => { e.stopPropagation(); setNodeConfig({ ...nodeConfig, proxyEnabled: !nodeConfig.proxyEnabled }); }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${nodeConfig.proxyEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${nodeConfig.proxyEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
                <ChevronRight className={`w-5 h-5 text-sanctuary-400 transition-transform ${expandedSection === 'proxy' ? 'rotate-90' : ''}`} />
              </div>
            </button>

            {expandedSection === 'proxy' && nodeConfig.proxyEnabled && (
              <div className="px-4 pb-4 space-y-4 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
                {/* Bundled Tor Container - Primary Option */}
                {torContainerStatus?.available && (
                  <div className={`p-3 rounded-xl border ${
                    nodeConfig.proxyHost === 'tor'
                      ? 'border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/20'
                      : 'border-sanctuary-200 dark:border-sanctuary-700'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Shield className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                        <div>
                          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Bundled Tor</span>
                          <p className="text-xs text-sanctuary-500">
                            {!torContainerStatus.exists ? 'Not installed' : torContainerStatus.running ? 'Running' : 'Stopped'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {torContainerStatus.running && nodeConfig.proxyHost !== 'tor' && (
                          <button
                            onClick={() => handleProxyPreset('tor-container')}
                            className="text-xs px-2 py-1 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200"
                          >
                            Use
                          </button>
                        )}
                        {nodeConfig.proxyHost === 'tor' && torContainerStatus.running && (
                          <CheckCircle className="w-4 h-4 text-violet-600" />
                        )}
                        <button
                          onClick={refreshTorContainerStatus}
                          className="p-1 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 text-sanctuary-400 ${isTorContainerLoading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={handleTorContainerToggle}
                          disabled={isTorContainerLoading}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                            torContainerStatus.running ? 'bg-violet-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                          }`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
                            torContainerStatus.running ? 'translate-x-5' : 'translate-x-1'
                          }`}>
                            {isTorContainerLoading && <Loader2 className="w-3.5 h-3.5 text-violet-600 animate-spin" />}
                          </span>
                        </button>
                      </div>
                    </div>
                    {torContainerMessage && (
                      <p className={`text-xs mt-2 ${
                        torContainerMessage.includes('ready') || torContainerMessage.includes('success')
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : torContainerMessage.includes('bootstrap') || torContainerMessage.includes('10-30s')
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-sanctuary-600 dark:text-sanctuary-400'
                      }`}>
                        {torContainerMessage}
                      </p>
                    )}
                    {!torContainerStatus.running && torContainerStatus.exists && !torContainerMessage && (
                      <p className="text-xs mt-2 text-sanctuary-500">
                        Starting Tor takes 10-30 seconds to connect to the network.
                      </p>
                    )}
                  </div>
                )}

                {/* Use Custom Proxy Toggle - Only show when bundled Tor is not selected */}
                {!(nodeConfig.proxyHost === 'tor' && torContainerStatus?.running) && (
                  <>
                    <button
                      onClick={() => setShowCustomProxy(!showCustomProxy)}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      {showCustomProxy ? 'Hide custom proxy settings' : 'Use custom proxy...'}
                    </button>

                    {showCustomProxy && (
                      <div className="space-y-3 p-3 surface-muted rounded-lg">
                        {/* Quick Presets */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleProxyPreset('tor')}
                            className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                              nodeConfig.proxyHost === '127.0.0.1' && nodeConfig.proxyPort === 9050
                                ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700'
                                : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100'
                            }`}
                          >
                            Tor Daemon (9050)
                          </button>
                          <button
                            onClick={() => handleProxyPreset('tor-browser')}
                            className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                              nodeConfig.proxyHost === '127.0.0.1' && nodeConfig.proxyPort === 9150
                                ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700'
                                : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100'
                            }`}
                          >
                            Tor Browser (9150)
                          </button>
                        </div>

                        {/* Host & Port */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-sanctuary-500 mb-1">Host</label>
                            <input
                              type="text"
                              value={nodeConfig.proxyHost || ''}
                              onChange={(e) => setNodeConfig({ ...nodeConfig, proxyHost: e.target.value })}
                              placeholder="127.0.0.1"
                              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-sanctuary-500 mb-1">Port</label>
                            <input
                              type="number"
                              value={nodeConfig.proxyPort || ''}
                              onChange={(e) => setNodeConfig({ ...nodeConfig, proxyPort: parseInt(e.target.value, 10) || undefined })}
                              placeholder="9050"
                              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                            />
                          </div>
                        </div>

                        {/* Optional Authentication */}
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            type="text"
                            value={nodeConfig.proxyUsername || ''}
                            onChange={(e) => setNodeConfig({ ...nodeConfig, proxyUsername: e.target.value || undefined })}
                            placeholder="Username (optional)"
                            className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                          />
                          <input
                            type="password"
                            value={nodeConfig.proxyPassword || ''}
                            onChange={(e) => setNodeConfig({ ...nodeConfig, proxyPassword: e.target.value || undefined })}
                            placeholder="Password (optional)"
                            className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Test Button & Result */}
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleTestProxy}
                    isLoading={proxyTestStatus === 'testing'}
                    disabled={proxyTestStatus === 'testing' || !nodeConfig.proxyHost || !nodeConfig.proxyPort}
                  >
                    Verify Connection
                  </Button>
                  {proxyTestMessage && proxyTestStatus !== 'idle' && (
                    <div className={`flex items-center gap-1.5 text-sm ${
                      proxyTestStatus === 'success' ? 'text-emerald-600' : proxyTestStatus === 'error' ? 'text-rose-600' : 'text-blue-600'
                    }`}>
                      {proxyTestStatus === 'success' && <CheckCircle className="w-4 h-4" />}
                      {proxyTestStatus === 'error' && <XCircle className="w-4 h-4" />}
                      {proxyTestStatus === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>{proxyTestMessage}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
