import React, { useState, useEffect } from 'react';
import { NodeConfig as NodeConfigType } from '../types';
import { Button } from './ui/Button';
import { Server, Check, AlertCircle, Link as LinkIcon, CheckCircle, XCircle, Gauge, Globe } from 'lucide-react';
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

  useEffect(() => {
    const loadData = async () => {
      try {
        const nc = await adminApi.getNodeConfig();
        setNodeConfig(nc);
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
              {/* Fee Estimator URL */}
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Fee Estimator URL</label>
                <input
                  type="text"
                  value={nodeConfig.feeEstimatorUrl || ''}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: e.target.value })}
                  placeholder="https://mempool.space"
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
                <div className="flex space-x-2 mt-3">
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: 'https://mempool.space' })}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      nodeConfig.feeEstimatorUrl === 'https://mempool.space'
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                        : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    mempool.space
                  </button>
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: '' })}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      !nodeConfig.feeEstimatorUrl
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                        : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    Use Block Explorer
                  </button>
                </div>
                <p className="text-xs text-sanctuary-400 mt-2">
                  {nodeConfig.feeEstimatorUrl
                    ? `Using ${nodeConfig.feeEstimatorUrl} for fee rates and block confirmation`
                    : `Using Block Explorer (${nodeConfig.explorerUrl || 'https://mempool.space'}) for fee rates and block confirmation`}
                </p>
              </div>

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

          {/* Section 3: Node Connection */}
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-sanctuary-50/50 dark:bg-sanctuary-800/30">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Node Connection</h3>
                  <p className="text-xs text-sanctuary-500">Backend server for blockchain data and transaction broadcasting</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Node Type & SSL */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Node Type</label>
                  <select
                    value={nodeConfig.type}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, type: e.target.value as 'electrum' | 'bitcoind' })}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${nodeConfig.useSsl ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
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
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Port</label>
                  <input
                    type="text"
                    value={nodeConfig.port}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, port: e.target.value })}
                    placeholder="8332"
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
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
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">RPC Password</label>
                    <input
                      type="password"
                      value={nodeConfig.password || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, password: e.target.value })}
                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              )}

              {/* Public Electrum Servers */}
              {nodeConfig.type === 'electrum' && (
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

              {/* Connection Test Result */}
              {testMessage && testStatus !== 'idle' && (
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
              )}

              {/* Test Button */}
              <div className="pt-2">
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
              </div>
            </div>
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
