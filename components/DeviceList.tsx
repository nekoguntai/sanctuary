import React, { useEffect, useState, useMemo } from 'react';
import { WalletType, HardwareDevice, HardwareDeviceModel } from '../types';
import { getDevices, updateDevice, deleteDevice, getDeviceModels, Device as ApiDevice } from '../src/api/devices';
import { Edit2, Save, X, HardDrive, Plus, LayoutGrid, List as ListIcon, Trash2, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { getDeviceIcon } from './ui/CustomIcons';
import { Button } from './ui/Button';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';

const log = createLogger('DeviceList');

type ViewMode = 'list' | 'grouped';
type SortField = 'label' | 'type' | 'fingerprint' | 'wallets';
type SortOrder = 'asc' | 'desc';

// Extended device type with wallet info from API
interface DeviceWithWallets extends ApiDevice {
  wallets?: Array<{
    wallet: {
      id: string;
      name: string;
      type: string;
      scriptType?: string;
    };
  }>;
}

export const DeviceList: React.FC = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<DeviceWithWallets[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, updatePreferences } = useUser();

  // Get view mode from user preferences, fallback to 'list'
  const viewMode = (user?.preferences?.viewSettings?.devices?.layout as ViewMode) || 'list';

  const setViewMode = (mode: ViewMode) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, layout: mode }
      }
    });
  };

  // Get sort settings from user preferences
  const sortBy = (user?.preferences?.viewSettings?.devices?.sortBy as SortField) || 'label';
  const sortOrder = (user?.preferences?.viewSettings?.devices?.sortOrder as SortOrder) || 'asc';

  const setSortBy = (field: SortField) => {
    // If clicking the same field, toggle order; otherwise set new field with asc
    const newOrder = field === sortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, sortBy: field, sortOrder: newOrder }
      }
    });
  };

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editType, setEditType] = useState('');
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);

  // Delete state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        const [deviceData, models] = await Promise.all([
          getDevices(),
          getDeviceModels()
        ]);
        setDevices(deviceData as DeviceWithWallets[]);
        setDeviceModels(models);
      } catch (error) {
        log.error('Failed to fetch devices', { error });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  const handleEdit = (device: DeviceWithWallets) => {
    setEditingId(device.id);
    setEditValue(device.label);
    // Use model.slug if available, otherwise empty (model slug is what dropdown uses)
    setEditType(device.model?.slug || '');
  };

  const handleSave = async (device: DeviceWithWallets) => {
    try {
      const updateData: { label?: string; modelSlug?: string } = {};
      if (editValue !== device.label) updateData.label = editValue;
      if (editType !== (device.model?.slug || '')) updateData.modelSlug = editType;

      const updatedDevice = await updateDevice(device.id, updateData);
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...updatedDevice, label: editValue } : d));
      setEditingId(null);
    } catch (error) {
      log.error('Failed to update device', { error });
    }
  };

  const handleDelete = async (device: DeviceWithWallets) => {
    try {
      setDeleteError(null);
      await deleteDevice(device.id);
      setDevices(prev => prev.filter(d => d.id !== device.id));
      setDeleteConfirmId(null);
    } catch (error: any) {
      log.error('Failed to delete device', { error });
      // Show error message from API
      const message = error.message || 'Failed to delete device';
      setDeleteError(message);
    }
  };

  const getAssociatedWallets = (device: DeviceWithWallets) => {
    return device.wallets?.map(w => ({
      id: w.wallet.id,
      name: w.wallet.name,
      type: w.wallet.type === 'multi_sig' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG
    })) || [];
  };

  // Sort devices based on current sort settings
  const sortedDevices = useMemo(() => {
    if (!devices.length) return devices;

    return [...devices].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'label':
          comparison = a.label.localeCompare(b.label);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'fingerprint':
          comparison = a.fingerprint.localeCompare(b.fingerprint);
          break;
        case 'wallets':
          comparison = (a.wallets?.length || 0) - (b.wallets?.length || 0);
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [devices, sortBy, sortOrder]);

  // Group devices by Type
  const groupedDevices = devices.reduce((acc, device) => {
    const type = device.type as HardwareDevice;
    if (!acc[type]) acc[type] = [];
    acc[type].push(device);
    return acc;
  }, {} as Record<HardwareDevice, DeviceWithWallets[]>);

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading devices...</div>;

  // Empty state
  if (devices.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in pb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Hardware Devices</h2>
            <p className="text-sanctuary-500">Manage your signers and keys</p>
          </div>
        </div>

        <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full surface-secondary mb-4">
            <HardDrive className="w-8 h-8 text-sanctuary-400" />
          </div>
          <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Devices Connected</h3>
          <p className="text-sanctuary-500 mb-6 max-w-md mx-auto">
            Connect your hardware wallet to start securing your Bitcoin. Sanctuary supports ColdCard, Ledger, Trezor, and many more.
          </p>
          <Button onClick={() => navigate('/devices/connect')}>
            <Plus className="w-4 h-4 mr-2" />
            Connect Your First Device
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-8">

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Hardware Devices</h2>
          <p className="text-sanctuary-500">Manage your signers and keys</p>
        </div>
        <div className="flex items-center space-x-3">
            <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                    title="List View"
                >
                    <ListIcon className="w-4 h-4" />
                </button>
                <button
                    onClick={() => setViewMode('grouped')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'grouped' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                    title="Grouped View"
                >
                    <LayoutGrid className="w-4 h-4" />
                </button>
            </div>
            <Button onClick={() => navigate('/devices/connect')}>
                <Plus className="w-4 h-4 mr-2" />
                Connect New Device
            </Button>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'list' && (
        <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
              <thead className="surface-muted">
                <tr>
                  <th
                    scope="col"
                    onClick={() => setSortBy('label')}
                    className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Label
                      {sortBy === 'label' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                    </span>
                  </th>
                  <th
                    scope="col"
                    onClick={() => setSortBy('type')}
                    className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Type
                      {sortBy === 'type' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                    </span>
                  </th>
                  <th
                    scope="col"
                    onClick={() => setSortBy('fingerprint')}
                    className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Fingerprint
                      {sortBy === 'fingerprint' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                    </span>
                  </th>
                  <th
                    scope="col"
                    onClick={() => setSortBy('wallets')}
                    className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Wallets
                      {sortBy === 'wallets' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                    </span>
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="surface-elevated divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
                {sortedDevices.map((device) => {
                  const associatedWallets = getAssociatedWallets(device);
                  const isEditing = editingId === device.id;

                  return (
                    <tr
                      key={device.id}
                      onClick={() => navigate(`/devices/${device.id}`)}
                      className="hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors cursor-pointer"
                    >
                      {/* Label */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-8 w-8 rounded-full surface-secondary flex items-center justify-center text-sanctuary-600 dark:text-sanctuary-300">
                            {getDeviceIcon(device.type as HardwareDevice, "w-4 h-4")}
                          </div>
                          <div className="ml-4">
                            {isEditing ? (
                              <div className="flex flex-col space-y-2" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    placeholder="Label"
                                    className="px-2 py-1 text-sm border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                    autoFocus
                                  />
                                  <button onClick={() => handleSave(device)} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors" aria-label="Save device"><Save className="w-4 h-4" /></button>
                                  <button onClick={() => setEditingId(null)} className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors" aria-label="Cancel editing"><X className="w-4 h-4" /></button>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <label className="text-xs text-sanctuary-500">Type:</label>
                                  <select
                                    value={editType}
                                    onChange={(e) => setEditType(e.target.value)}
                                    className="flex-1 px-2 py-1 text-xs border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                  >
                                    <option value="">Unknown Device</option>
                                    {deviceModels.map(model => (
                                      <option key={model.slug} value={model.slug}>
                                        {model.manufacturer} {model.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center group">
                                <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{device.label}</span>
                                <button onClick={(e) => { e.stopPropagation(); handleEdit(device); }} className="ml-2 opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-sanctuary-600 transition-opacity"><Edit2 className="w-3 h-3" /></button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{device.type}</span>
                      </td>

                      {/* Fingerprint */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-xs surface-secondary px-2 py-1 rounded text-sanctuary-600 dark:text-sanctuary-400">{device.fingerprint}</span>
                      </td>

                      {/* Wallets */}
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {associatedWallets.length > 0 ? (
                            associatedWallets.map(w => {
                              const isMultisig = w.type === WalletType.MULTI_SIG;
                              const badgeClass = isMultisig
                                ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                                : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                              return (
                                <span key={w.id} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
                                  {w.name}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-xs text-sanctuary-400 italic">Unused</span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        {associatedWallets.length === 0 && (
                          <div className="relative inline-block">
                            {deleteConfirmId === device.id ? (
                              <div className="flex items-center space-x-2 bg-rose-50 dark:bg-rose-900/30 p-2 rounded-lg">
                                <span className="text-xs text-rose-700 dark:text-rose-300">Delete?</span>
                                <button
                                  onClick={() => handleDelete(device)}
                                  className="px-2 py-1 text-xs bg-rose-600 text-white rounded hover:bg-rose-700 transition-colors"
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => { setDeleteConfirmId(null); setDeleteError(null); }}
                                  className="px-2 py-1 text-xs bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300 rounded hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(device.id)}
                                className="p-2 text-sanctuary-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
                                title="Delete device"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            {deleteError && deleteConfirmId === device.id && (
                              <div className="absolute right-0 top-full mt-1 p-2 bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 text-xs rounded shadow-lg z-10 whitespace-nowrap">
                                {deleteError}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grouped View */}
      {viewMode === 'grouped' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 animate-fade-in">
           {(Object.entries(groupedDevices) as [string, DeviceWithWallets[]][]).map(([type, groupDevices]) => {
              const deviceType = type as HardwareDevice;
              return (
                <div key={type} className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 surface-secondary flex items-center justify-between">
                       <div className="flex items-center space-x-3">
                          <div className="p-2 bg-white dark:bg-sanctuary-700 rounded-lg shadow-sm text-sanctuary-600 dark:text-sanctuary-300">
                             {getDeviceIcon(deviceType, "w-6 h-6")}
                          </div>
                          <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{type}</h3>
                       </div>
                       <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
                          {groupDevices.length}
                       </span>
                    </div>
                    
                    {/* Device List */}
                    <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
                        <ul className="space-y-3">
                           {groupDevices.map(device => {
                              const associatedWallets = getAssociatedWallets(device);
                              const isEditing = editingId === device.id;
                              
                              return (
                                 <li
                                   key={device.id}
                                   onClick={() => navigate(`/devices/${device.id}`)}
                                   className="p-3 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800 hover:border-sanctuary-300 dark:hover:border-sanctuary-600 transition-colors surface-elevated cursor-pointer"
                                 >
                                     <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1 min-w-0">
                                            {isEditing ? (
                                                <div className="flex flex-col space-y-1 mb-1" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center space-x-1">
                                                        <input
                                                            type="text"
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            className="w-full px-2 py-1 text-xs border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none"
                                                            autoFocus
                                                        />
                                                        <button onClick={() => handleSave(device)} className="p-1 text-emerald-600" aria-label="Save device"><Save className="w-3 h-3" /></button>
                                                        <button onClick={() => setEditingId(null)} className="p-1 text-rose-600" aria-label="Cancel editing"><X className="w-3 h-3" /></button>
                                                    </div>
                                                    <div className="flex items-center space-x-1">
                                                        <label className="text-[10px] text-sanctuary-500">Type:</label>
                                                        <select
                                                            value={editType}
                                                            onChange={(e) => setEditType(e.target.value)}
                                                            className="flex-1 px-1 py-0.5 text-[10px] border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none"
                                                        >
                                                            <option value="">Unknown Device</option>
                                                            {deviceModels.map(model => (
                                                                <option key={model.slug} value={model.slug}>
                                                                    {model.manufacturer} {model.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center group">
                                                    <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate mr-2">{device.label}</span>
                                                    <button onClick={(e) => { e.stopPropagation(); handleEdit(device); }} className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-sanctuary-600 transition-opacity"><Edit2 className="w-3 h-3" /></button>
                                                    {associatedWallets.length === 0 && (
                                                      <button
                                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(device.id); }}
                                                        className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-rose-600 transition-opacity ml-1"
                                                        title="Delete device"
                                                      >
                                                        <Trash2 className="w-3 h-3" />
                                                      </button>
                                                    )}
                                                </div>
                                            )}
                                            <div className="text-xs font-mono text-sanctuary-500">{device.fingerprint}</div>
                                        </div>

                                        {/* Delete confirmation */}
                                        {deleteConfirmId === device.id && (
                                          <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                                            <span className="text-[10px] text-rose-600">Delete?</span>
                                            <button
                                              onClick={() => handleDelete(device)}
                                              className="px-1 py-0.5 text-[10px] bg-rose-600 text-white rounded hover:bg-rose-700"
                                            >
                                              Yes
                                            </button>
                                            <button
                                              onClick={() => { setDeleteConfirmId(null); setDeleteError(null); }}
                                              className="px-1 py-0.5 text-[10px] bg-sanctuary-200 dark:bg-sanctuary-700 rounded hover:bg-sanctuary-300"
                                            >
                                              No
                                            </button>
                                          </div>
                                        )}
                                     </div>

                                     {/* Mini Wallet Tags */}
                                     <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-sanctuary-50 dark:border-sanctuary-800">
                                         {associatedWallets.length > 0 ? (
                                             associatedWallets.map(w => {
                                                 const isMultisig = w.type === WalletType.MULTI_SIG;
                                                 const tagClass = isMultisig
                                                    ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                                                    : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                                                 return (
                                                     <span key={w.id} className={`text-[10px] px-1.5 py-0.5 rounded flex items-center truncate max-w-[100px] ${tagClass}`}>
                                                         <HardDrive className="w-2 h-2 mr-1 flex-shrink-0" /> {w.name}
                                                     </span>
                                                 );
                                             })
                                         ) : (
                                             <span className="text-[10px] text-sanctuary-300 italic">Unused</span>
                                         )}
                                     </div>
                                 </li>
                              );
                           })}
                        </ul>
                    </div>
                </div>
              );
           })}
        </div>
      )}
    </div>
  );
};