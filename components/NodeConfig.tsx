import React, { useState, useEffect } from 'react';
import { NodeConfig as NodeConfigType, ElectrumServer } from '../types';
import { Button } from './ui/Button';
import { Server, Check, AlertCircle, Link as LinkIcon, CheckCircle, XCircle, Gauge, Globe, Layers, Plus, Trash2, Edit2, ChevronUp, ChevronDown, RefreshCw, Activity } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { createLogger } from '../utils/logger';

const log = createLogger('NodeConfig');

// List of well-known public Electrum servers
const PUBLIC_ELECTRUM_SERVERS = [
  { name: 'Blockstream (SSL)', host: 'electrum.blockstream.info', port: '50002', useSsl: true },
  { name: 'Blockstream (TCP)', host: 'electrum.blockstream.info', port: '50001', useSsl: false },
  { name: 'mempool.space (SSL)', host: 'electrum.mempool.space', port: '50002', useSsl: true },
  { name: 'Emzy (SSL)', host: 'electrum.emzy.de', port: '50002', useSsl: true },
  { name: 'Bitaroo (SSL)', host: 'electrum.bitaroo.net', port: '50002', useSsl: true },
  { name: 'Diynodes (SSL)', host: 'electrum.diynodes.com', port: '50002', useSsl: true },
  { name: 'hsmiths (SSL)', host: 'electrum.hsmiths.com', port: '50002', useSsl: true },
  { name: 'qtornado (SSL)', host: 'electrum.qtornado.com', port: '50002', useSsl: true },
];

export const NodeConfig: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [nodeConfig, setNodeConfig] = useState<NodeConfigType | null>(null);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [nodeSaveSuccess, setNodeSaveSuccess] = useState(false);
  const [nodeSaveError, setNodeSaveError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');

  // Server pool management state
  const [servers, setServers] = useState<ElectrumServer[]>([]);
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [newServer, setNewServer] = useState({ label: '', host: '', port: 50002, useSsl: true });
  const [serverTestStatus, setServerTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [serverTestErrors, setServerTestErrors] = useState<Record<string, string>>({});
  const [serverActionLoading, setServerActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [nc, serverList] = await Promise.all([
          adminApi.getNodeConfig(),
          adminApi.getElectrumServers().catch(() => []),
        ]);
        setNodeConfig(nc);
        setServers(serverList);
      } catch (error) {
        log.error('Failed to load data', { error });
        // Set default node config if API call fails - use Blockstream public server
        setNodeConfig({
          type: 'electrum',
          host: 'electrum.blockstream.info',
          port: '50002',
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          feeEstimatorUrl: 'https://mempool.space',
          mempoolEstimator: 'mempool_space'
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

  const handleTestConnection = async () => {
    if (!nodeConfig) return;

    setTestStatus('testing');
    setTestMessage('Connecting to node...');

    try {
      const result = await adminApi.testNodeConfig(nodeConfig);

      if (result.success) {
        setTestStatus('success');
        setTestMessage(result.message || 'Connection successful');
      } else {
        setTestStatus('error');
        setTestMessage(result.message || result.error || 'Connection failed');
      }
    } catch (error: any) {
      log.error('Test connection error', { error });
      setTestStatus('error');
      setTestMessage(error.response?.data?.message || error.message || 'Failed to test connection');
    }

    // Clear status after 5 seconds
    setTimeout(() => {
      setTestStatus('idle');
      setTestMessage('');
    }, 5000);
  };

  // Get the effective fee estimator URL for display
  const getEffectiveFeeUrl = () => {
    return nodeConfig?.feeEstimatorUrl || nodeConfig?.explorerUrl || 'https://mempool.space';
  };

  // Server management handlers
  const handleAddServer = async () => {
    if (!newServer.label || !newServer.host) return;

    setServerActionLoading('add');
    try {
      const server = await adminApi.addElectrumServer({
        label: newServer.label,
        host: newServer.host,
        port: newServer.port,
        useSsl: newServer.useSsl,
        priority: servers.length,
        enabled: true,
      });
      setServers([...servers, server]);
      setNewServer({ label: '', host: '', port: 50002, useSsl: true });
      setIsAddingServer(false);
    } catch (error) {
      log.error('Failed to add server', { error });
      setNodeSaveError('Failed to add server');
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleUpdateServer = async (id: string, data: Partial<ElectrumServer>) => {
    setServerActionLoading(id);
    try {
      const updated = await adminApi.updateElectrumServer(id, data);
      setServers(servers.map(s => s.id === id ? updated : s));
      setEditingServerId(null);
    } catch (error) {
      log.error('Failed to update server', { error });
      setNodeSaveError('Failed to update server');
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleDeleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this server?')) return;

    setServerActionLoading(id);
    try {
      await adminApi.deleteElectrumServer(id);
      setServers(servers.filter(s => s.id !== id));
    } catch (error) {
      log.error('Failed to delete server', { error });
      setNodeSaveError('Failed to delete server');
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleTestServer = async (id: string) => {
    setServerTestStatus(prev => ({ ...prev, [id]: 'testing' }));
    setServerTestErrors(prev => ({ ...prev, [id]: '' }));
    try {
      const result = await adminApi.testElectrumServer(id);
      setServerTestStatus(prev => ({ ...prev, [id]: result.success ? 'success' : 'error' }));
      if (!result.success && result.message) {
        setServerTestErrors(prev => ({ ...prev, [id]: result.message }));
      }
      // Reload servers to get updated health check error
      const updatedServers = await adminApi.getElectrumServers();
      setServers(updatedServers);
      setTimeout(() => setServerTestStatus(prev => ({ ...prev, [id]: 'idle' })), 15000);
    } catch (error) {
      log.error('Failed to test server', { error });
      setServerTestStatus(prev => ({ ...prev, [id]: 'error' }));
      setServerTestErrors(prev => ({ ...prev, [id]: error instanceof Error ? error.message : 'Connection failed' }));
      setTimeout(() => setServerTestStatus(prev => ({ ...prev, [id]: 'idle' })), 15000);
    }
  };

  const handleMoveServer = async (id: string, direction: 'up' | 'down') => {
    const index = servers.findIndex(s => s.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === servers.length - 1) return;

    const newServers = [...servers];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newServers[index], newServers[swapIndex]] = [newServers[swapIndex], newServers[index]];

    // Update priorities
    const serverIds = newServers.map(s => s.id);
    setServers(newServers);

    try {
      await adminApi.reorderElectrumServers(serverIds);
    } catch (error) {
      log.error('Failed to reorder servers', { error });
      // Revert on error
      setServers(servers);
    }
  };

  const handleQuickAddServer = (preset: typeof PUBLIC_ELECTRUM_SERVERS[0]) => {
    setNewServer({
      label: preset.name,
      host: preset.host,
      port: parseInt(preset.port, 10),
      useSsl: preset.useSsl,
    });
    setIsAddingServer(true);
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

          {/* Section 3: Node Connection (Single Server) */}
          <div className={`surface-elevated rounded-2xl border overflow-hidden transition-opacity ${
            nodeConfig.poolEnabled ? 'border-sanctuary-300 dark:border-sanctuary-700 opacity-50' : 'border-sanctuary-200 dark:border-sanctuary-800'
          }`}>
            <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-sanctuary-50/50 dark:bg-sanctuary-800/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${nodeConfig.poolEnabled ? 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-400' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Node Connection</h3>
                    <p className="text-xs text-sanctuary-500">Single server for blockchain data and transaction broadcasting</p>
                  </div>
                </div>
                {nodeConfig.poolEnabled && (
                  <span className="text-xs px-2 py-1 bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 rounded-lg">
                    Disabled (using pool)
                  </span>
                )}
              </div>
            </div>

            <div className={`p-5 space-y-5 ${nodeConfig.poolEnabled ? 'pointer-events-none' : ''}`}>
              {/* Node Type & SSL */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Node Type</label>
                  <select
                    value={nodeConfig.type}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, type: e.target.value as 'electrum' | 'bitcoind' })}
                    disabled={nodeConfig.poolEnabled}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    <option value="electrum">Electrum Server</option>
                    <option value="bitcoind">Bitcoin Core (RPC)</option>
                  </select>
                </div>
                {nodeConfig.type === 'electrum' && (
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">SSL / TLS</label>
                    <div className="flex items-center h-10">
                      <button
                        onClick={() => setNodeConfig({ ...nodeConfig, useSsl: !nodeConfig.useSsl })}
                        disabled={nodeConfig.poolEnabled}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${nodeConfig.useSsl ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${nodeConfig.useSsl ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                      <span className="ml-3 text-sm text-sanctuary-500">{nodeConfig.useSsl ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Host & Port */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Host / IP</label>
                  <input
                    type="text"
                    value={nodeConfig.host}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, host: e.target.value })}
                    placeholder="127.0.0.1"
                    disabled={nodeConfig.poolEnabled}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Port</label>
                  <input
                    type="text"
                    value={nodeConfig.port}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, port: e.target.value })}
                    placeholder="8332"
                    disabled={nodeConfig.poolEnabled}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Bitcoin Core Credentials */}
              {nodeConfig.type === 'bitcoind' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">RPC User</label>
                    <input
                      type="text"
                      value={nodeConfig.user || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, user: e.target.value })}
                      disabled={nodeConfig.poolEnabled}
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">RPC Password</label>
                    <input
                      type="password"
                      value={nodeConfig.password || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, password: e.target.value })}
                      disabled={nodeConfig.poolEnabled}
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    />
                  </div>
                </div>
              )}

              {/* Public Electrum Servers */}
              {nodeConfig.type === 'electrum' && !nodeConfig.poolEnabled && (
                <>
                  <div className="border-t border-sanctuary-100 dark:border-sanctuary-800" />
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <Globe className="w-4 h-4 text-sanctuary-400" />
                      <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Public Electrum Servers</label>
                    </div>
                    <p className="text-xs text-sanctuary-500">Quick-select from well-known public servers. Free to use but may have privacy implications.</p>
                    <div className="grid grid-cols-2 gap-2">
                      {PUBLIC_ELECTRUM_SERVERS.map((server) => (
                        <button
                          key={`${server.host}:${server.port}`}
                          onClick={() => setNodeConfig({
                            ...nodeConfig,
                            host: server.host,
                            port: server.port,
                            useSsl: server.useSsl
                          })}
                          className={`text-left px-3 py-2 text-xs rounded-lg border transition-colors ${
                            nodeConfig.host === server.host && nodeConfig.port === server.port
                              ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                              : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                          }`}
                        >
                          <div className="font-medium">{server.name}</div>
                          <div className="text-[10px] text-sanctuary-500 font-mono truncate">{server.host}:{server.port}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Connection Test Result - Only show when pool disabled */}
              {!nodeConfig.poolEnabled && testMessage && testStatus !== 'idle' && (
                <>
                  <div className="border-t border-sanctuary-100 dark:border-sanctuary-800" />
                  <div className={`p-4 rounded-xl border animate-fade-in ${
                    testStatus === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                      : testStatus === 'error'
                      ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                      : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                  }`}>
                    <div className="flex items-start">
                      {testStatus === 'success' && <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mr-2 flex-shrink-0 mt-0.5" />}
                      {testStatus === 'error' && <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 mr-2 flex-shrink-0 mt-0.5" />}
                      {testStatus === 'testing' && <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2 flex-shrink-0 mt-0.5 animate-pulse" />}
                      <span className={`text-sm font-medium ${
                        testStatus === 'success'
                          ? 'text-emerald-800 dark:text-emerald-300'
                          : testStatus === 'error'
                          ? 'text-rose-800 dark:text-rose-300'
                          : 'text-blue-800 dark:text-blue-300'
                      }`}>
                        {testMessage}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* Test Button - Only show when pool disabled */}
              {!nodeConfig.poolEnabled && (
                <>
                  <div className="border-t border-sanctuary-100 dark:border-sanctuary-800" />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestConnection}
                    isLoading={testStatus === 'testing'}
                    disabled={testStatus === 'testing'}
                    className="w-full"
                  >
                    Test Connection
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Section 4: Connection Pooling (Multi-Server) - Electrum Only */}
          {nodeConfig.type === 'electrum' && (
            <div className={`surface-elevated rounded-2xl border overflow-hidden transition-opacity ${
              !nodeConfig.poolEnabled ? 'border-sanctuary-300 dark:border-sanctuary-700 opacity-75' : 'border-sanctuary-200 dark:border-sanctuary-800'
            }`}>
              <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-sanctuary-50/50 dark:bg-sanctuary-800/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${!nodeConfig.poolEnabled ? 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}`}>
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Connection Pool</h3>
                      <p className="text-xs text-sanctuary-500">Multiple servers with load balancing and failover</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, poolEnabled: !nodeConfig.poolEnabled })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${nodeConfig.poolEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${nodeConfig.poolEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              {nodeConfig.poolEnabled && (
                <div className="p-5 space-y-5">
                  {/* Pool Settings */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Min Connections</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={nodeConfig.poolMinConnections ?? 1}
                        onChange={(e) => setNodeConfig({ ...nodeConfig, poolMinConnections: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
                        className="w-full px-2 py-1.5 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Max Connections</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={nodeConfig.poolMaxConnections ?? 5}
                        onChange={(e) => setNodeConfig({ ...nodeConfig, poolMaxConnections: Math.max(1, Math.min(20, parseInt(e.target.value) || 5)) })}
                        className="w-full px-2 py-1.5 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Load Balancing</label>
                      <select
                        value={nodeConfig.poolLoadBalancing || 'round_robin'}
                        onChange={(e) => setNodeConfig({ ...nodeConfig, poolLoadBalancing: e.target.value as 'round_robin' | 'least_connections' | 'failover_only' })}
                        className="w-full px-2 py-1.5 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="round_robin">Round Robin</option>
                        <option value="least_connections">Least Connections</option>
                        <option value="failover_only">Failover Only</option>
                      </select>
                    </div>
                  </div>

                  {/* Server Pool */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Activity className="w-4 h-4 text-sanctuary-400" />
                        <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Servers</label>
                        <span className="text-xs text-sanctuary-400">({servers.length} server{servers.length !== 1 ? 's' : ''})</span>
                      </div>
                      <button
                        onClick={() => setIsAddingServer(true)}
                        className="flex items-center space-x-1 text-xs px-2 py-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Server</span>
                      </button>
                    </div>

                    {/* Server List with Health Stats */}
                    <div className="space-y-2">
                      {servers.sort((a, b) => a.priority - b.priority).map((server, index) => (
                        <div
                          key={server.id}
                          className={`p-3 rounded-lg border transition-colors ${
                            server.enabled
                              ? server.isHealthy !== false
                                ? 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700'
                                : 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                              : 'bg-sanctuary-100/50 dark:bg-sanctuary-800/50 border-sanctuary-200 dark:border-sanctuary-700 opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3 flex-1 min-w-0">
                              {/* Priority Controls */}
                              <div className="flex flex-col">
                                <button
                                  onClick={() => handleMoveServer(server.id, 'up')}
                                  disabled={index === 0}
                                  className="p-0.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <ChevronUp className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleMoveServer(server.id, 'down')}
                                  disabled={index === servers.length - 1}
                                  className="p-0.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <ChevronDown className="w-3 h-3" />
                                </button>
                              </div>

                              {/* Server Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2">
                                  <span className="font-medium text-sm truncate">{server.label}</span>
                                  {server.isHealthy === false && (
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded cursor-help"
                                      title={server.lastHealthCheckError || 'Connection failed'}
                                    >
                                      unhealthy
                                    </span>
                                  )}
                                  {!server.enabled && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 rounded">
                                      disabled
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-sanctuary-500 font-mono truncate">
                                  {server.host}:{server.port} {server.useSsl && '(SSL)'}
                                </div>
                                {/* Health Stats */}
                                <div className="flex items-center space-x-3 mt-1 text-[10px] text-sanctuary-400">
                                  {server.lastHealthCheck && (
                                    <span title="Last health check">
                                      Checked: {new Date(server.lastHealthCheck).toLocaleTimeString()}
                                    </span>
                                  )}
                                  {server.healthCheckFails !== undefined && server.healthCheckFails > 0 && (
                                    <span className="text-amber-500" title="Consecutive failures">
                                      Fails: {server.healthCheckFails}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center space-x-1 ml-2">
                              {/* Test Status */}
                              {serverTestStatus[server.id] === 'testing' && (
                                <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
                              )}
                              {serverTestStatus[server.id] === 'success' && (
                                <CheckCircle className="w-4 h-4 text-emerald-500" />
                              )}
                              {serverTestStatus[server.id] === 'error' && (
                                <span title={serverTestErrors[server.id] || server.lastHealthCheckError || 'Connection test failed'}>
                                  <XCircle className="w-4 h-4 text-rose-500 cursor-help" />
                                </span>
                              )}

                              <button
                                onClick={() => handleTestServer(server.id)}
                                disabled={serverTestStatus[server.id] === 'testing'}
                                className="p-1.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded transition-colors"
                                title="Test connection"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleUpdateServer(server.id, { enabled: !server.enabled })}
                                className="p-1.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded transition-colors"
                                title={server.enabled ? 'Disable' : 'Enable'}
                              >
                                {server.enabled ? (
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5 text-sanctuary-400" />
                                )}
                              </button>
                              <button
                                onClick={() => handleDeleteServer(server.id)}
                                disabled={serverActionLoading === server.id}
                                className="p-1.5 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded transition-colors text-rose-600 dark:text-rose-400"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add Server Form */}
                    {isAddingServer && (
                      <div className="p-4 surface-secondary rounded-lg border border-primary-300 dark:border-primary-700 space-y-3">
                        <div className="font-medium text-sm">Add New Server</div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">Label</label>
                            <input
                              type="text"
                              value={newServer.label}
                              onChange={(e) => setNewServer({ ...newServer, label: e.target.value })}
                              placeholder="My Server"
                              className="w-full px-2 py-1.5 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">Host</label>
                            <input
                              type="text"
                              value={newServer.host}
                              onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                              placeholder="electrum.example.com"
                              className="w-full px-2 py-1.5 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">Port</label>
                            <input
                              type="number"
                              value={newServer.port}
                              onChange={(e) => setNewServer({ ...newServer, port: parseInt(e.target.value) || 50002 })}
                              className="w-full px-2 py-1.5 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">SSL</label>
                            <button
                              onClick={() => setNewServer({ ...newServer, useSsl: !newServer.useSsl })}
                              className={`w-full px-2 py-1.5 text-sm rounded-lg border transition-colors ${
                                newServer.useSsl
                                  ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                                  : 'surface-muted border-sanctuary-200 dark:border-sanctuary-700'
                              }`}
                            >
                              {newServer.useSsl ? 'SSL Enabled' : 'SSL Disabled'}
                            </button>
                          </div>
                        </div>

                        {/* Quick Add from Presets */}
                        <div>
                          <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">Quick Add</label>
                          <div className="flex flex-wrap gap-1">
                            {PUBLIC_ELECTRUM_SERVERS.map((preset) => (
                              <button
                                key={`${preset.host}:${preset.port}`}
                                onClick={() => handleQuickAddServer(preset)}
                                className="text-[10px] px-2 py-1 rounded border surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
                              >
                                {preset.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end space-x-2 pt-2">
                          <button
                            onClick={() => {
                              setIsAddingServer(false);
                              setNewServer({ label: '', host: '', port: 50002, useSsl: true });
                            }}
                            className="px-3 py-1.5 text-xs rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleAddServer}
                            disabled={!newServer.label || !newServer.host || serverActionLoading === 'add'}
                            className="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {serverActionLoading === 'add' ? 'Adding...' : 'Add Server'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Add first server prompt when no servers */}
                    {servers.length === 0 && !isAddingServer && (
                      <div className="text-center py-4 text-sanctuary-400 text-sm">
                        <p>No servers configured.</p>
                        <button
                          onClick={() => setIsAddingServer(true)}
                          className="mt-2 text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          Add a server to enable multi-server pooling
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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
