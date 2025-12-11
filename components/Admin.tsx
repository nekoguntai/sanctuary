import React, { useState, useEffect } from 'react';
import { NodeConfig } from '../types';
import { Button } from './ui/Button';
import { Users, UserPlus, Shield, User as UserIcon, Plus, Server, Check, AlertCircle, Link as LinkIcon, CheckCircle, XCircle, Trash2, Edit2, X, Eye, EyeOff, Gauge } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { AdminUser, AdminGroup } from '../src/api/admin';

export const Admin: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Create User Modal State
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Edit User Modal State
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editUserError, setEditUserError] = useState<string | null>(null);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);

  // Create Group State
  const [newGroup, setNewGroup] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Edit Group Modal State
  const [editingGroup, setEditingGroup] = useState<AdminGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupMembers, setEditGroupMembers] = useState<string[]>([]);
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  const [isUpdatingGroup, setIsUpdatingGroup] = useState(false);

  // Node Configuration State
  const [nodeConfig, setNodeConfig] = useState<NodeConfig | null>(null);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [nodeSaveSuccess, setNodeSaveSuccess] = useState(false);
  const [nodeSaveError, setNodeSaveError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');

  const loadData = async () => {
    try {
      console.log('[Admin] Loading data...');
      const [usersData, groupsData, nc] = await Promise.all([
        adminApi.getUsers(),
        adminApi.getGroups(),
        adminApi.getNodeConfig()
      ]);
      console.log('[Admin] Data loaded:', { users: usersData, groups: groupsData, nodeConfig: nc });
      setUsers(usersData);
      setGroups(groupsData);
      setNodeConfig(nc);
    } catch (error) {
      console.error('[Admin] Failed to load data:', error);
      // Set default node config if API call fails
      setNodeConfig({
        type: 'electrum',
        host: '127.0.0.1',
        port: '50001',
        useSsl: false,
        explorerUrl: 'https://mempool.space',
        feeEstimatorUrl: 'https://mempool.space'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      setCreateUserError('Username and password are required');
      return;
    }

    setIsCreatingUser(true);
    setCreateUserError(null);

    try {
      await adminApi.createUser({
        username: newUsername.trim(),
        password: newPassword,
        email: newEmail.trim() || undefined,
        isAdmin: newIsAdmin
      });

      // Reset form and close modal
      setNewUsername('');
      setNewPassword('');
      setNewEmail('');
      setNewIsAdmin(false);
      setShowCreateUser(false);

      // Reload users
      loadData();
    } catch (error: any) {
      console.error('[Admin] Create user error:', error);
      setCreateUserError(error.message || 'Failed to create user');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleEditUser = (user: AdminUser) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditEmail(user.email || '');
    setEditIsAdmin(user.isAdmin);
    setEditPassword('');
    setEditUserError(null);
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    setIsUpdatingUser(true);
    setEditUserError(null);

    try {
      const updateData: adminApi.UpdateUserRequest = {};

      if (editUsername !== editingUser.username) {
        updateData.username = editUsername;
      }
      if (editEmail !== (editingUser.email || '')) {
        updateData.email = editEmail || undefined;
      }
      if (editIsAdmin !== editingUser.isAdmin) {
        updateData.isAdmin = editIsAdmin;
      }
      if (editPassword) {
        updateData.password = editPassword;
      }

      await adminApi.updateUser(editingUser.id, updateData);

      setEditingUser(null);
      loadData();
    } catch (error: any) {
      console.error('[Admin] Update user error:', error);
      setEditUserError(error.message || 'Failed to update user');
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    if (!confirm(`Are you sure you want to delete user "${user.username}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await adminApi.deleteUser(user.id);
      loadData();
    } catch (error: any) {
      console.error('[Admin] Delete user error:', error);
      alert(error.message || 'Failed to delete user');
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroup.trim()) return;

    setIsCreatingGroup(true);

    try {
      await adminApi.createGroup({ name: newGroup.trim() });
      setNewGroup('');
      loadData();
    } catch (error: any) {
      console.error('[Admin] Create group error:', error);
      alert(error.message || 'Failed to create group');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (group: AdminGroup) => {
    if (!confirm(`Are you sure you want to delete group "${group.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await adminApi.deleteGroup(group.id);
      loadData();
    } catch (error: any) {
      console.error('[Admin] Delete group error:', error);
      alert(error.message || 'Failed to delete group');
    }
  };

  const handleEditGroup = (group: AdminGroup) => {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditGroupMembers(group.members.map(m => m.userId));
    setEditGroupError(null);
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup) return;

    setIsUpdatingGroup(true);
    setEditGroupError(null);

    try {
      await adminApi.updateGroup(editingGroup.id, {
        name: editGroupName,
        memberIds: editGroupMembers,
      });

      setEditingGroup(null);
      loadData();
    } catch (error: any) {
      console.error('[Admin] Update group error:', error);
      setEditGroupError(error.message || 'Failed to update group');
    } finally {
      setIsUpdatingGroup(false);
    }
  };

  const toggleGroupMember = (userId: string) => {
    setEditGroupMembers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

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
      console.error('[Admin] Failed to save node config:', error);
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
      console.error('[Admin] Test connection error:', error);
      setTestStatus('error');
      setTestMessage(error.response?.data?.message || error.message || 'Failed to test connection');
    }

    // Clear status after 5 seconds
    setTimeout(() => {
      setTestStatus('idle');
      setTestMessage('');
    }, 5000);
  };

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading administrative data...</div>;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Administration</h2>
        <p className="text-sanctuary-500">Manage system configuration, users, and groups</p>
      </div>

      {/* Node Configuration */}
      <div className="bg-white dark:bg-sanctuary-900 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg text-primary-600 dark:text-primary-500">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Bitcoin Node Configuration</h3>
              <p className="text-sm text-sanctuary-500">Configure the backend Bitcoin node connection (applies to all users)</p>
            </div>
          </div>
        </div>

        {nodeConfig && (
          <div className="p-6 space-y-6">
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

            {/* Explorer Settings */}
            <div className="space-y-4 border-b border-sanctuary-100 dark:border-sanctuary-800 pb-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Block Explorer</label>
                  <p className="text-xs text-sanctuary-500">External service used for transaction lookups.</p>
                </div>
                <LinkIcon className="w-4 h-4 text-sanctuary-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">Explorer URL</label>
                <input
                  type="text"
                  value={nodeConfig.explorerUrl || ''}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, explorerUrl: e.target.value })}
                  placeholder="https://mempool.space"
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
                <div className="flex space-x-2 mt-2">
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, explorerUrl: 'https://mempool.space' })}
                    className="text-xs bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-1 rounded hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
                  >
                    Use mempool.space
                  </button>
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, explorerUrl: 'https://blockstream.info' })}
                    className="text-xs bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-1 rounded hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
                  >
                    Use blockstream.info
                  </button>
                </div>
              </div>
            </div>

            {/* Fee Estimator Settings */}
            <div className="space-y-4 border-b border-sanctuary-100 dark:border-sanctuary-800 pb-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Fee Estimator</label>
                  <p className="text-xs text-sanctuary-500">mempool.space-compatible API for fee rate estimation.</p>
                </div>
                <Gauge className="w-4 h-4 text-sanctuary-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">Fee Estimator URL</label>
                <input
                  type="text"
                  value={nodeConfig.feeEstimatorUrl || ''}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: e.target.value })}
                  placeholder="https://mempool.space"
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
                <div className="flex space-x-2 mt-2">
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: 'https://mempool.space' })}
                    className="text-xs bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-1 rounded hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
                  >
                    Use mempool.space (default)
                  </button>
                  <button
                    onClick={() => setNodeConfig({ ...nodeConfig, feeEstimatorUrl: '' })}
                    className="text-xs bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-1 rounded hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
                  >
                    Use Block Explorer URL
                  </button>
                </div>
                <p className="text-xs text-sanctuary-400 mt-2">
                  {nodeConfig.feeEstimatorUrl
                    ? `Using ${nodeConfig.feeEstimatorUrl} for fee estimation.`
                    : `Using Block Explorer URL (${nodeConfig.explorerUrl || 'https://mempool.space'}) for fee estimation.`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Node Type</label>
                <select
                  value={nodeConfig.type}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, type: e.target.value as 'electrum' | 'bitcoind' })}
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="bitcoind">Bitcoin Core (RPC)</option>
                  <option value="electrum">Electrum Server</option>
                </select>
              </div>
              {nodeConfig.type === 'electrum' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">SSL / TLS</label>
                  </div>
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

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Host / IP</label>
                <input
                  type="text"
                  value={nodeConfig.host}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, host: e.target.value })}
                  placeholder="127.0.0.1"
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Port</label>
                <input
                  type="text"
                  value={nodeConfig.port}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, port: e.target.value })}
                  placeholder="8332"
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
              </div>
            </div>

            {nodeConfig.type === 'bitcoind' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">RPC User</label>
                  <input
                    type="text"
                    value={nodeConfig.user || ''}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, user: e.target.value })}
                    className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">RPC Password</label>
                  <input
                    type="password"
                    value={nodeConfig.password || ''}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, password: e.target.value })}
                    className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}

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

            <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
              <div className="flex items-center space-x-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleTestConnection}
                  isLoading={testStatus === 'testing'}
                  disabled={testStatus === 'testing'}
                >
                  Test Connection
                </Button>
              </div>
              <Button onClick={handleSaveNodeConfig} isLoading={isSavingNode}>Save Network Config</Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* User Management */}
        <div className="space-y-6">
           <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sanctuary-900 dark:text-sanctuary-100">
                <Users className="w-5 h-5" />
                <h3 className="text-lg font-medium">Users</h3>
              </div>
              <Button size="sm" onClick={() => setShowCreateUser(true)}>
                <UserPlus className="w-4 h-4 mr-2" /> Add User
              </Button>
           </div>

           <div className="bg-white dark:bg-sanctuary-900 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
              <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800 max-h-96 overflow-y-auto">
                 {users.length === 0 ? (
                   <li className="p-8 text-center text-sanctuary-400">No users found</li>
                 ) : users.map(u => (
                   <li key={u.id} className="p-4 flex items-center justify-between hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
                      <div className="flex items-center space-x-3">
                         <div className={`p-2 rounded-full ${u.isAdmin ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400'}`}>
                            {u.isAdmin ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                         </div>
                         <div>
                            <p className="font-medium text-sm">{u.username}</p>
                            <p className="text-xs text-sanctuary-400">{u.email || 'No email'}</p>
                         </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {u.isAdmin && (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 px-2 py-1 rounded">
                            Admin
                          </span>
                        )}
                        <button
                          onClick={() => handleEditUser(u)}
                          className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
                          title="Edit user"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1.5 text-sanctuary-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          title="Delete user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                   </li>
                 ))}
              </ul>
           </div>
        </div>

        {/* Group Management */}
         <div className="space-y-6">
           <div className="flex items-center space-x-2 text-sanctuary-900 dark:text-sanctuary-100">
              <Users className="w-5 h-5" />
              <h3 className="text-lg font-medium">Groups</h3>
           </div>

           <div className="bg-white dark:bg-sanctuary-900 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
              <div className="p-4 bg-sanctuary-50 dark:bg-sanctuary-800 border-b border-sanctuary-100 dark:border-sanctuary-800">
                 <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newGroup}
                      onChange={(e) => setNewGroup(e.target.value)}
                      placeholder="New group name"
                      className="flex-1 px-3 py-2 text-sm rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                    />
                    <Button size="sm" onClick={handleCreateGroup} disabled={!newGroup || isCreatingGroup} isLoading={isCreatingGroup}>
                       <Plus className="w-4 h-4 mr-2" /> Create
                    </Button>
                 </div>
              </div>
              <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800 max-h-96 overflow-y-auto">
                 {groups.length === 0 ? (
                   <li className="p-8 text-center text-sanctuary-400">No groups found</li>
                 ) : groups.map(g => (
                   <li key={g.id} className="p-4 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                         <h4 className="font-medium text-sm">{g.name}</h4>
                         <div className="flex items-center space-x-2">
                           <span className="text-xs bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-0.5 rounded text-sanctuary-600 dark:text-sanctuary-400">
                              {g.members.length} Members
                           </span>
                           <button
                             onClick={() => handleEditGroup(g)}
                             className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
                             title="Edit group"
                           >
                             <Edit2 className="w-3.5 h-3.5" />
                           </button>
                           <button
                             onClick={() => handleDeleteGroup(g)}
                             className="p-1 text-sanctuary-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                             title="Delete group"
                           >
                             <Trash2 className="w-3.5 h-3.5" />
                           </button>
                         </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                         {g.members.length === 0 ? (
                           <span className="text-[10px] text-sanctuary-400 italic">No members</span>
                         ) : g.members.map(member => (
                           <span key={member.userId} className="text-[10px] px-1.5 py-0.5 border border-sanctuary-200 dark:border-sanctuary-700 rounded text-sanctuary-500">
                             {member.username} {member.role === 'admin' && '(admin)'}
                           </span>
                         ))}
                      </div>
                   </li>
                 ))}
              </ul>
           </div>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateUser(false)}>
          <div className="bg-white dark:bg-sanctuary-900 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Create New User</h3>
              <button onClick={() => setShowCreateUser(false)} className="text-sanctuary-400 hover:text-sanctuary-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {createUserError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                {createUserError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username *</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter password (min 6 characters)"
                    className="w-full px-3 py-2 pr-10 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email (optional)</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setNewIsAdmin(!newIsAdmin)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${newIsAdmin ? 'bg-amber-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${newIsAdmin ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">Administrator privileges</span>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <Button variant="secondary" onClick={() => setShowCreateUser(false)}>Cancel</Button>
              <Button onClick={handleCreateUser} isLoading={isCreatingUser} disabled={!newUsername || !newPassword}>
                Create User
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingUser(null)}>
          <div className="bg-white dark:bg-sanctuary-900 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Edit User: {editingUser.username}</h3>
              <button onClick={() => setEditingUser(null)} className="text-sanctuary-400 hover:text-sanctuary-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {editUserError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                {editUserError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">New Password (leave blank to keep current)</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full px-3 py-2 pr-10 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setEditIsAdmin(!editIsAdmin)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${editIsAdmin ? 'bg-amber-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editIsAdmin ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">Administrator privileges</span>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <Button variant="secondary" onClick={() => setEditingUser(null)}>Cancel</Button>
              <Button onClick={handleUpdateUser} isLoading={isUpdatingUser}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingGroup(null)}>
          <div className="bg-white dark:bg-sanctuary-900 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Edit Group</h3>
              <button onClick={() => setEditingGroup(null)} className="text-sanctuary-400 hover:text-sanctuary-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {editGroupError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                {editGroupError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Group Name</label>
                <input
                  type="text"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  className="w-full px-3 py-2 bg-sanctuary-50 dark:bg-sanctuary-950 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Members</label>
                <div className="max-h-48 overflow-y-auto border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg">
                  {users.length === 0 ? (
                    <p className="p-3 text-sm text-sanctuary-400 text-center">No users available</p>
                  ) : (
                    users.map(user => (
                      <label
                        key={user.id}
                        className="flex items-center p-3 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 cursor-pointer border-b border-sanctuary-100 dark:border-sanctuary-800 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={editGroupMembers.includes(user.id)}
                          onChange={() => toggleGroupMember(user.id)}
                          className="w-4 h-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">{user.username}</span>
                        {user.isAdmin && (
                          <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">(admin)</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-xs text-sanctuary-400">
                  {editGroupMembers.length} member{editGroupMembers.length !== 1 ? 's' : ''} selected
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <Button variant="secondary" onClick={() => setEditingGroup(null)}>Cancel</Button>
              <Button onClick={handleUpdateGroup} isLoading={isUpdatingGroup} disabled={!editGroupName.trim()}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
