import React, { useState, useEffect } from 'react';
import { ElectrumServer } from '../types';
import { Button } from './ui/Button';
import {
  Server,
  Plus,
  Trash2,
  Edit2,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  CheckCircle,
  XCircle,
  Globe,
  Activity,
} from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { createLogger } from '../utils/logger';

const log = createLogger('ElectrumServerSettings');

type Network = 'mainnet' | 'testnet' | 'signet';

// Preset servers for each network
const PRESET_SERVERS = {
  mainnet: [
    { name: 'Blockstream (SSL)', host: 'electrum.blockstream.info', port: 50002, useSsl: true },
    { name: 'Blockstream (TCP)', host: 'electrum.blockstream.info', port: 50001, useSsl: false },
  ],
  testnet: [
    { name: 'Blockstream Testnet', host: 'electrum.blockstream.info', port: 60002, useSsl: true },
    { name: 'Aranguren Testnet', host: 'testnet.aranguren.org', port: 51002, useSsl: true },
    { name: 'Hsmiths Testnet', host: 'testnet.hsmiths.com', port: 53012, useSsl: true },
  ],
  signet: [
    { name: 'Mutinynet Signet', host: 'electrum.mutinynet.com', port: 50002, useSsl: true },
  ],
};

interface ElectrumServerSettingsProps {
  poolEnabled?: boolean;
  onPoolEnabledChange?: (enabled: boolean) => void;
}

export const ElectrumServerSettings: React.FC<ElectrumServerSettingsProps> = ({
  poolEnabled = false,
  onPoolEnabledChange,
}) => {
  const [selectedNetwork, setSelectedNetwork] = useState<Network>('mainnet');
  const [servers, setServers] = useState<Record<Network, ElectrumServer[]>>({
    mainnet: [],
    testnet: [],
    signet: [],
  });
  const [loading, setLoading] = useState(true);
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [newServer, setNewServer] = useState({
    label: '',
    host: '',
    port: 50002,
    useSsl: true,
  });
  const [serverTestStatus, setServerTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [serverTestErrors, setServerTestErrors] = useState<Record<string, string>>({});
  const [serverActionLoading, setServerActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoading(true);
      // Load servers for all networks
      const [mainnetServers, testnetServers, signetServers] = await Promise.all([
        adminApi.getElectrumServers('mainnet').catch(() => []),
        adminApi.getElectrumServers('testnet').catch(() => []),
        adminApi.getElectrumServers('signet').catch(() => []),
      ]);

      setServers({
        mainnet: mainnetServers,
        testnet: testnetServers,
        signet: signetServers,
      });
    } catch (error) {
      log.error('Failed to load servers', { error });
    } finally {
      setLoading(false);
    }
  };

  const handleAddServer = async () => {
    try {
      setServerActionLoading('add');
      const server = await adminApi.addElectrumServer({
        ...newServer,
        network: selectedNetwork,
        enabled: true,
        priority: servers[selectedNetwork].length + 1,
      });

      setServers((prev) => ({
        ...prev,
        [selectedNetwork]: [...prev[selectedNetwork], server],
      }));

      setIsAddingServer(false);
      setNewServer({ label: '', host: '', port: 50002, useSsl: true });
    } catch (error: any) {
      log.error('Failed to add server', { error });
      alert(error.response?.data?.message || 'Failed to add server');
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleUpdateServer = async (id: string, updates: Partial<ElectrumServer>) => {
    try {
      setServerActionLoading(id);
      const updatedServer = await adminApi.updateElectrumServer(id, updates);

      setServers((prev) => ({
        ...prev,
        [selectedNetwork]: prev[selectedNetwork].map((s) =>
          s.id === id ? updatedServer : s
        ),
      }));

      if (editingServerId === id) {
        setEditingServerId(null);
        setNewServer({ label: '', host: '', port: 50002, useSsl: true });
      }
    } catch (error: any) {
      log.error('Failed to update server', { error });
      alert(error.response?.data?.message || 'Failed to update server');
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleDeleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this server?')) return;

    try {
      setServerActionLoading(id);
      await adminApi.deleteElectrumServer(id);

      setServers((prev) => ({
        ...prev,
        [selectedNetwork]: prev[selectedNetwork].filter((s) => s.id !== id),
      }));
    } catch (error) {
      log.error('Failed to delete server', { error });
      alert('Failed to delete server');
    } finally {
      setServerActionLoading(null);
    }
  };

  const handleTestServer = async (id: string) => {
    setServerTestStatus((prev) => ({ ...prev, [id]: 'testing' }));
    setServerTestErrors((prev) => ({ ...prev, [id]: '' }));

    try {
      const result = await adminApi.testElectrumServer(id);

      if (result.success) {
        setServerTestStatus((prev) => ({ ...prev, [id]: 'success' }));
        setTimeout(() => {
          setServerTestStatus((prev) => ({ ...prev, [id]: 'idle' }));
        }, 3000);
      } else {
        setServerTestStatus((prev) => ({ ...prev, [id]: 'error' }));
        setServerTestErrors((prev) => ({ ...prev, [id]: result.message || 'Connection failed' }));
      }
    } catch (error: any) {
      log.error('Server test failed', { error });
      setServerTestStatus((prev) => ({ ...prev, [id]: 'error' }));
      setServerTestErrors((prev) => ({ ...prev, [id]: error.message || 'Test failed' }));
    }
  };

  const handleMoveServer = async (id: string, direction: 'up' | 'down') => {
    const sortedServers = [...servers[selectedNetwork]].sort((a, b) => a.priority - b.priority);
    const index = sortedServers.findIndex((s) => s.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sortedServers.length - 1) return;

    const newServers = [...sortedServers];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newServers[index], newServers[swapIndex]] = [newServers[swapIndex], newServers[index]];

    const updatedServers = newServers.map((s, i) => ({ ...s, priority: i }));
    const serverIds = updatedServers.map((s) => s.id);

    setServers((prev) => ({
      ...prev,
      [selectedNetwork]: updatedServers,
    }));

    try {
      await adminApi.reorderElectrumServers(serverIds);
    } catch (error) {
      log.error('Failed to reorder servers', { error });
      // Reload on error
      loadServers();
    }
  };

  const handleQuickAddServer = (preset: typeof PRESET_SERVERS.mainnet[0]) => {
    setNewServer({
      label: preset.name,
      host: preset.host,
      port: preset.port,
      useSsl: preset.useSsl,
    });
    setIsAddingServer(true);
  };

  const currentServers = servers[selectedNetwork] || [];
  const presetServers = PRESET_SERVERS[selectedNetwork] || [];

  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading server configuration...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Network Tabs */}
      <div className="flex space-x-1 p-1 surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700">
        {(['mainnet', 'testnet', 'signet'] as Network[]).map((network) => {
          const serverCount = servers[network]?.length || 0;
          const healthyCount = servers[network]?.filter(s => s.enabled && s.isHealthy !== false).length || 0;

          return (
            <button
              key={network}
              onClick={() => setSelectedNetwork(network)}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                selectedNetwork === network
                  ? network === 'mainnet'
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : network === 'testnet'
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 shadow-sm'
                    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 shadow-sm'
                  : 'text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <span className="capitalize">{network}</span>
                {serverCount > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedNetwork === network
                      ? network === 'mainnet'
                        ? 'bg-emerald-200 dark:bg-emerald-800/50'
                        : network === 'testnet'
                        ? 'bg-amber-200 dark:bg-amber-800/50'
                        : 'bg-purple-200 dark:bg-purple-800/50'
                      : 'bg-sanctuary-200 dark:bg-sanctuary-700'
                  }`}>
                    {healthyCount}/{serverCount}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Network Info Banner */}
      <div className={`p-4 rounded-xl border ${
        selectedNetwork === 'mainnet'
          ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
          : selectedNetwork === 'testnet'
          ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
          : 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800'
      }`}>
        <div className="flex items-start space-x-3">
          <Globe className={`w-5 h-5 mt-0.5 ${
            selectedNetwork === 'mainnet'
              ? 'text-emerald-600 dark:text-emerald-400'
              : selectedNetwork === 'testnet'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-purple-600 dark:text-purple-400'
          }`} />
          <div className="flex-1">
            <h4 className={`text-sm font-medium mb-1 ${
              selectedNetwork === 'mainnet'
                ? 'text-emerald-900 dark:text-emerald-100'
                : selectedNetwork === 'testnet'
                ? 'text-amber-900 dark:text-amber-100'
                : 'text-purple-900 dark:text-purple-100'
            }`}>
              {selectedNetwork === 'mainnet' && 'Bitcoin Mainnet'}
              {selectedNetwork === 'testnet' && 'Bitcoin Testnet'}
              {selectedNetwork === 'signet' && 'Bitcoin Signet'}
            </h4>
            <p className={`text-xs ${
              selectedNetwork === 'mainnet'
                ? 'text-emerald-700 dark:text-emerald-300'
                : selectedNetwork === 'testnet'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-purple-700 dark:text-purple-300'
            }`}>
              {selectedNetwork === 'mainnet' && 'Production network with real Bitcoin. Use trusted servers only.'}
              {selectedNetwork === 'testnet' && 'Test network with worthless test coins. Safe for development and testing.'}
              {selectedNetwork === 'signet' && 'Alternative test network with more control. Ideal for development.'}
            </p>
          </div>
        </div>
      </div>

      {/* Preset Servers */}
      {presetServers.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-sanctuary-400" />
            <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Quick Add Presets</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {presetServers.map((server) => (
              <button
                key={`${server.host}:${server.port}`}
                onClick={() => handleQuickAddServer(server)}
                className="text-left px-3 py-2 text-xs rounded-lg border surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
              >
                <div className="font-medium">{server.name}</div>
                <div className="text-[10px] text-sanctuary-500 font-mono truncate">
                  {server.host}:{server.port}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-sanctuary-400" />
            <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
              Configured Servers
            </label>
            <span className="text-xs text-sanctuary-400">
              ({currentServers.length} server{currentServers.length !== 1 ? 's' : ''})
            </span>
          </div>
          <button
            onClick={() => {
              setIsAddingServer(true);
              setEditingServerId(null);
              setNewServer({ label: '', host: '', port: selectedNetwork === 'testnet' ? 60002 : 50002, useSsl: true });
            }}
            className="flex items-center space-x-1 text-xs px-2 py-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Add Server</span>
          </button>
        </div>

        {/* Server Items */}
        <div className="space-y-2">
          {[...currentServers].sort((a, b) => a.priority - b.priority).map((server, index) => (
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
                      disabled={index === currentServers.length - 1}
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
                    onClick={() => {
                      setEditingServerId(server.id);
                      setNewServer({
                        label: server.label,
                        host: server.host,
                        port: server.port,
                        useSsl: server.useSsl,
                      });
                      setIsAddingServer(true);
                    }}
                    className="p-1.5 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-600 rounded transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
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

          {currentServers.length === 0 && (
            <div className="text-center py-8 text-sanctuary-500 text-sm">
              No servers configured for {selectedNetwork}. Add a server to get started.
            </div>
          )}
        </div>

        {/* Add/Edit Server Form */}
        {isAddingServer && (
          <div className="p-4 surface-secondary rounded-lg border border-primary-300 dark:border-primary-700 space-y-3">
            <div className="font-medium text-sm">
              {editingServerId ? 'Edit Server' : 'Add New Server'}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
                  Label
                </label>
                <input
                  type="text"
                  value={newServer.label}
                  onChange={(e) => setNewServer({ ...newServer, label: e.target.value })}
                  placeholder="My Server"
                  className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
                  Host
                </label>
                <input
                  type="text"
                  value={newServer.host}
                  onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                  placeholder="electrum.example.com"
                  className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={newServer.port}
                  onChange={(e) =>
                    setNewServer({ ...newServer, port: parseInt(e.target.value) || 50002 })
                  }
                  className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
                  Protocol
                </label>
                <select
                  value={newServer.useSsl ? 'ssl' : 'tcp'}
                  onChange={(e) =>
                    setNewServer({ ...newServer, useSsl: e.target.value === 'ssl' })
                  }
                  className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="ssl">SSL</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
            </div>
            <div className="flex space-x-2">
              <Button
                type="button"
                variant="primary"
                onClick={editingServerId ? () => handleUpdateServer(editingServerId, newServer) : handleAddServer}
                isLoading={serverActionLoading !== null}
                className="flex-1 text-xs py-1.5"
              >
                {editingServerId ? 'Update' : 'Add'} Server
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsAddingServer(false);
                  setEditingServerId(null);
                  setNewServer({ label: '', host: '', port: 50002, useSsl: true });
                }}
                className="flex-1 text-xs py-1.5"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
