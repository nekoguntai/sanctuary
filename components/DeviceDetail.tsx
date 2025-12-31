import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WalletType, ApiWalletType, HardwareDevice, HardwareDeviceModel, DeviceRole, Device, DeviceShareInfo } from '../types';
import { getDevice, updateDevice, getDeviceModels, getDeviceShareInfo, shareDeviceWithUser, removeUserFromDevice, shareDeviceWithGroup } from '../src/api/devices';
import * as authApi from '../src/api/auth';
import * as adminApi from '../src/api/admin';
import { getDeviceIcon, getWalletIcon } from './ui/CustomIcons';
import { Edit2, Save, X, ArrowLeft, ChevronDown, Users, Shield, Send, User as UserIcon } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';
import { TransferOwnershipModal } from './TransferOwnershipModal';
import { PendingTransfersPanel } from './PendingTransfersPanel';

const log = createLogger('DeviceDetail');

type TabType = 'details' | 'access';

// Wallet info for display
interface WalletInfo {
  id: string;
  name: string;
  type: WalletType | ApiWalletType;
}

// Group display type
interface GroupDisplay {
  id: string;
  name: string;
}

export const DeviceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useUser();

  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editModelSlug, setEditModelSlug] = useState<string>('');
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [accessSubTab, setAccessSubTab] = useState<'ownership' | 'sharing' | 'transfers'>('ownership');
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Sharing state
  const [deviceShareInfo, setDeviceShareInfo] = useState<DeviceShareInfo | null>(null);
  const [groups, setGroups] = useState<GroupDisplay[]>([]);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);

  // Derived ownership state
  const isOwner = device?.isOwner ?? true; // Default to true for backward compat
  const userRole = device?.userRole ?? 'owner';

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !user) return;
      try {
        // Fetch device and available models in parallel
        const [deviceData, models] = await Promise.all([
          getDevice(id),
          getDeviceModels()
        ]);

        setDevice(deviceData);
        setDeviceModels(models);

        // Warn if ownership fields are missing (indicates API issue)
        if (deviceData.isOwner === undefined || deviceData.userRole === undefined) {
          log.warn('Device ownership fields missing from API response', {
            deviceId: id,
            hasIsOwner: deviceData.isOwner !== undefined,
            hasUserRole: deviceData.userRole !== undefined,
          });
        }

        // Extract wallet info from device data
        const walletList = deviceData.wallets?.map(w => ({
          id: w.wallet.id,
          name: w.wallet.name,
          type: w.wallet.type === 'multi_sig' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG
        })) || [];
        setWallets(walletList);
        setEditLabel(deviceData.label);
        setEditModelSlug(deviceData.model?.slug || '');
      } catch (error) {
        log.error('Failed to fetch device', { error });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, user]);

  const handleSave = async () => {
    if (!device) return;
    try {
      const updateData: { label?: string; modelSlug?: string } = {};
      if (editLabel !== device.label) updateData.label = editLabel;
      if (editModelSlug !== (device.model?.slug || '')) updateData.modelSlug = editModelSlug;

      const updatedDevice = await updateDevice(device.id, updateData);
      setDevice({ ...device, ...updatedDevice, label: editLabel });
      setIsEditing(false);
    } catch (error) {
      log.error('Failed to update device', { error });
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditLabel(device?.label || '');
    setEditModelSlug(device?.model?.slug || '');
  };

  // Fetch share info
  const fetchShareInfo = useCallback(async () => {
    if (!id) return;
    try {
      const info = await getDeviceShareInfo(id);
      setDeviceShareInfo(info);
    } catch (err) {
      log.error('Failed to fetch share info', { err });
    }
  }, [id]);

  // Fetch groups
  const fetchGroups = useCallback(async () => {
    try {
      const userGroups = user?.isAdmin
        ? await adminApi.getGroups()
        : await authApi.getUserGroups();
      setGroups(userGroups);
    } catch (err) {
      log.error('Failed to fetch groups', { err });
    }
  }, [user?.isAdmin]);

  // Fetch sharing data when device is loaded
  useEffect(() => {
    if (device && id) {
      fetchShareInfo();
      fetchGroups();
    }
  }, [device, id, fetchShareInfo, fetchGroups]);

  // User search handler
  const handleSearchUsers = useCallback(async (query: string) => {
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }

    setSearchingUsers(true);
    try {
      const results = await authApi.searchUsers(query);
      const existingUserIds = new Set(deviceShareInfo?.users.map(u => u.id) || []);
      setUserSearchResults(results.filter(u => !existingUserIds.has(u.id)));
    } catch (err) {
      log.error('Failed to search users', { err });
    } finally {
      setSearchingUsers(false);
    }
  }, [deviceShareInfo]);

  // Share with user
  const handleShareWithUser = async (targetUserId: string) => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithUser(id, { targetUserId });
      await fetchShareInfo();
      setUserSearchQuery('');
      setUserSearchResults([]);
    } catch (err) {
      log.error('Failed to share with user', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Remove user access
  const handleRemoveUserAccess = async (targetUserId: string) => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await removeUserFromDevice(id, targetUserId);
      await fetchShareInfo();
    } catch (err) {
      log.error('Failed to remove user access', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Add group
  const addGroup = async () => {
    if (!id || !selectedGroupToAdd) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithGroup(id, { groupId: selectedGroupToAdd });
      await fetchShareInfo();
      setSelectedGroupToAdd('');
    } catch (err) {
      log.error('Failed to share with group', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Remove group
  const removeGroup = async () => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithGroup(id, { groupId: null });
      await fetchShareInfo();
    } catch (err) {
      log.error('Failed to remove group access', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Reload device data after transfer actions
  const handleTransferComplete = async () => {
    if (!id || !user) return;
    try {
      const deviceData = await getDevice(id);
      setDevice(deviceData);
    } catch (error) {
      log.error('Failed to reload device after transfer', { error });
    }
  };

  // Get display name for current device type
  const getDeviceDisplayName = (type: string): string => {
    const model = deviceModels.find(m => m.slug === type);
    return model ? model.name : type || 'Unknown Device';
  };

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading device...</div>;
  if (!device) return <div className="p-8 text-center text-sanctuary-400">Device not found.</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
        <button 
          onClick={() => navigate('/devices')} 
          className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Devices
        </button>

        <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
            <div className="flex items-start space-x-6">
                <div className="p-4 rounded-2xl surface-secondary text-sanctuary-600 dark:text-sanctuary-300">
                    {getDeviceIcon(device.type as HardwareDevice, "w-12 h-12")}
                </div>
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                         <div>
                            <div className="flex items-center space-x-2">
                                {isEditing ? (
                                    <div className="flex items-center space-x-2">
                                        <input
                                            value={editLabel}
                                            onChange={e => setEditLabel(e.target.value)}
                                            className="px-2 py-1 border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted text-xl font-light focus:outline-none"
                                        />
                                        <button onClick={handleSave} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors" aria-label="Save label"><Save className="w-5 h-5" /></button>
                                        <button onClick={cancelEdit} className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors" aria-label="Cancel editing"><X className="w-5 h-5" /></button>
                                    </div>
                                ) : (
                                    <>
                                        <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">{device.label}</h1>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                          userRole === 'owner' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' :
                                          'bg-sanctuary-100 text-sanctuary-700 dark:bg-sanctuary-700 dark:text-sanctuary-300'
                                        }`}>
                                          {userRole === 'owner' ? 'Owner' : 'Viewer'}
                                        </span>
                                        {isOwner && (
                                          <button onClick={() => setIsEditing(true)} className="text-sanctuary-400 hover:text-sanctuary-600 p-1" aria-label="Edit label"><Edit2 className="w-4 h-4" /></button>
                                        )}
                                    </>
                                )}
                            </div>
                            {/* Shared by indicator */}
                            {!isOwner && device.sharedBy && (
                              <span className="text-xs text-sanctuary-400 flex items-center gap-1 mt-1">
                                <Users className="w-3 h-3" />
                                Shared by {device.sharedBy}
                              </span>
                            )}
                            {isEditing ? (
                                <div className="mt-2">
                                    <label className="text-xs text-sanctuary-500 uppercase mb-1 block">Device Type</label>
                                    <div className="relative">
                                        <select
                                            value={editModelSlug}
                                            onChange={e => setEditModelSlug(e.target.value)}
                                            className="w-full px-3 py-2 pr-8 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                        >
                                            <option value="">Unknown Device</option>
                                            {deviceModels.map(model => (
                                                <option key={model.slug} value={model.slug}>
                                                    {model.manufacturer} {model.name}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400 pointer-events-none" />
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sanctuary-500 mt-1 text-sm">{getDeviceDisplayName(device.type)}</p>
                            )}
                         </div>
                         <div className="text-right">
                             <div className="text-xs text-sanctuary-400 uppercase tracking-wide">Master Fingerprint</div>
                             <div className="text-xl font-mono text-sanctuary-700 dark:text-sanctuary-300">{device.fingerprint}</div>
                         </div>
                    </div>

                    <div className="mt-6 pt-6 border-t border-sanctuary-100 dark:border-sanctuary-800 grid grid-cols-2 gap-6">
                        <div>
                             <p className="text-xs text-sanctuary-500 uppercase mb-1">Extended Public Key (XPUB)</p>
                             <div className="surface-muted p-3 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                                 <code className="text-xs text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono">{device.xpub || "N/A"}</code>
                             </div>
                        </div>
                         <div>
                             <p className="text-xs text-sanctuary-500 uppercase mb-1">Derivation Path</p>
                             <div className="surface-muted p-3 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                                 <code className="text-sm text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono">{device.derivationPath || "m/84'/0'/0'"}</code>
                             </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-sanctuary-200 dark:border-sanctuary-800">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'details'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('access')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'access'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              <Shield className="w-4 h-4" />
              Access
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'details' && (
          <div className="space-y-4">
               <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Associated Wallets</h3>
               {wallets.length === 0 ? (
                   <div className="surface-elevated rounded-xl p-8 text-center text-sanctuary-400 border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                       No wallets are currently using this device.
                   </div>
               ) : (
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {wallets.map(w => {
                           const isMultisig = w.type === WalletType.MULTI_SIG || w.type === 'multi_sig';
                           const badgeClass = isMultisig
                              ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                              : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                           return (
                              <div
                                  key={w.id}
                                  onClick={() => navigate(`/wallets/${w.id}`)}
                                  className="group cursor-pointer surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400 dark:hover:border-sanctuary-600 transition-all"
                              >
                                  <div className="flex items-center justify-between mb-2">
                                       <div className="flex items-center space-x-3">
                                           <div className="p-2 surface-secondary rounded-lg text-sanctuary-500">
                                               {getWalletIcon(w.type, "w-5 h-5")}
                                           </div>
                                           <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{w.name}</span>
                                       </div>
                                       <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${badgeClass}`}>
                                           {isMultisig ? 'Multisig' : 'Single Sig'}
                                       </span>
                                  </div>
                                  <div className="text-sm text-sanctuary-500 pl-10">
                                      ID: {w.id}
                                  </div>
                              </div>
                           );
                       })}
                   </div>
               )}
          </div>
        )}

        {activeTab === 'access' && (
          <div className="space-y-4">
            {/* Sub-tabs */}
            <div className="flex space-x-1 p-1 surface-secondary rounded-lg w-fit">
              {(['ownership', 'sharing', 'transfers'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAccessSubTab(tab)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                    accessSubTab === tab
                      ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                      : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Ownership Sub-tab */}
            {accessSubTab === 'ownership' && (
              <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
                  <div className="flex items-center">
                    <div className="h-9 w-9 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-base font-bold text-sanctuary-600 dark:text-sanctuary-300">
                      {deviceShareInfo?.users.find(u => u.role === 'owner')?.username?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="ml-3">
                      <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                        {deviceShareInfo?.users.find(u => u.role === 'owner')?.username || user?.username || 'You'}
                      </p>
                      <p className="text-xs text-sanctuary-500">Device Owner</p>
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => setShowTransferModal(true)}
                      className="flex items-center px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      Transfer
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Sharing Sub-tab */}
            {accessSubTab === 'sharing' && (
              <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800 space-y-4">
                {/* Add sharing controls - only for owners */}
                {isOwner && (
                  <div className="p-3 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                    <div className="flex flex-wrap gap-2">
                      {/* Group sharing */}
                      {!deviceShareInfo?.group && (
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedGroupToAdd}
                            onChange={(e) => setSelectedGroupToAdd(e.target.value)}
                            className="text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                          >
                            <option value="">Add group...</option>
                            {groups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                          {selectedGroupToAdd && (
                            <button
                              onClick={addGroup}
                              disabled={sharingLoading}
                              className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
                            >
                              Add as Viewer
                            </button>
                          )}
                        </div>
                      )}
                      {/* User sharing */}
                      <div className="flex-1 min-w-[200px] relative">
                        <input
                          type="text"
                          value={userSearchQuery}
                          onChange={(e) => handleSearchUsers(e.target.value)}
                          placeholder="Add user..."
                          className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                        />
                        {searchingUsers && (
                          <div className="absolute right-2 top-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent" />
                          </div>
                        )}
                        {userSearchResults.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {userSearchResults.map(u => (
                              <div key={u.id} className="px-2 py-1.5 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 flex items-center justify-between">
                                <div className="flex items-center">
                                  <div className="h-5 w-5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                                    {u.username.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-sm">{u.username}</span>
                                </div>
                                <button
                                  onClick={() => handleShareWithUser(u.id)}
                                  disabled={sharingLoading}
                                  className="text-xs px-1.5 py-0.5 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 disabled:opacity-50"
                                >
                                  Add as Viewer
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Current shared access */}
                <div className="space-y-2">
                  {/* Group */}
                  {deviceShareInfo?.group && (
                    <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                      <div className="flex items-center">
                        <Users className="w-4 h-4 text-sanctuary-500 mr-2" />
                        <span className="text-sm font-medium">{deviceShareInfo.group.name}</span>
                        <span className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                          Viewer
                        </span>
                      </div>
                      {isOwner && (
                        <button
                          onClick={removeGroup}
                          disabled={sharingLoading}
                          className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Individual users */}
                  {deviceShareInfo?.users.filter(u => u.role !== 'owner').map(u => (
                    <div key={u.id} className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                      <div className="flex items-center">
                        <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium">{u.username}</span>
                        <span className="ml-2 text-xs text-sanctuary-500 capitalize">{u.role}</span>
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveUserAccess(u.id)}
                          disabled={sharingLoading}
                          className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Empty state */}
                  {!deviceShareInfo?.group && (!deviceShareInfo?.users || deviceShareInfo.users.filter(u => u.role !== 'owner').length === 0) && (
                    <div className="text-center py-6 text-sanctuary-400 text-sm">
                      Not shared with anyone yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Transfers Sub-tab */}
            {accessSubTab === 'transfers' && (
              <PendingTransfersPanel
                resourceType="device"
                resourceId={id!}
                onTransferComplete={handleTransferComplete}
              />
            )}
          </div>
        )}

        {/* Transfer Ownership Modal */}
        {showTransferModal && device && (
          <TransferOwnershipModal
            resourceType="device"
            resourceId={device.id}
            resourceName={device.label}
            onClose={() => setShowTransferModal(false)}
            onTransferInitiated={() => {
              setShowTransferModal(false);
              // Could optionally refresh to show the pending transfer
            }}
          />
        )}
    </div>
  );
};