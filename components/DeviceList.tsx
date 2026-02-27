import React, { useEffect, useState, useMemo } from 'react';
import { HardwareDevice, HardwareDeviceModel, Device } from '../types';
import { getDevices, updateDevice, deleteDevice, getDeviceModels } from '../src/api/devices';
import { HardDrive, Plus, LayoutGrid, List as ListIcon, Users, User, Edit2, Save, X, Trash2 } from 'lucide-react';
import { getDeviceIcon, getWalletIcon } from './ui/CustomIcons';
import { Button } from './ui/Button';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { useLoadingState } from '../hooks/useLoadingState';
import { createLogger } from '../utils/logger';
import { extractErrorMessage } from '../utils/errorHandler';
import { ConfigurableTable } from './ui/ConfigurableTable';
import { ColumnConfigButton } from './ui/ColumnConfigButton';
import {
  DEVICE_COLUMNS,
  DEFAULT_DEVICE_COLUMN_ORDER,
  DEFAULT_DEVICE_VISIBLE_COLUMNS,
  mergeDeviceColumnOrder,
} from './columns/deviceColumns';
import { createDeviceCellRenderers, DeviceWithWallets } from './cells/DeviceCells';

const log = createLogger('DeviceList');

type ViewMode = 'list' | 'grouped';
type SortField = 'label' | 'type' | 'fingerprint' | 'wallets';
type SortOrder = 'asc' | 'desc';
type OwnershipFilter = 'all' | 'owned' | 'shared';

export const DeviceList: React.FC = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const { user, updatePreferences } = useUser();

  // Loading state using hook
  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });

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
  const ownershipFilter = (user?.preferences?.viewSettings?.devices?.ownershipFilter as OwnershipFilter) || 'all';

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

  const setOwnershipFilter = (filter: OwnershipFilter) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, ownershipFilter: filter }
      }
    });
  };

  // Get column configuration from user preferences
  const columnOrder = useMemo(
    () => mergeDeviceColumnOrder(user?.preferences?.viewSettings?.devices?.columnOrder),
    [user?.preferences?.viewSettings?.devices?.columnOrder]
  );
  const visibleColumns = user?.preferences?.viewSettings?.devices?.visibleColumns || DEFAULT_DEVICE_VISIBLE_COLUMNS;

  const handleColumnOrderChange = (newOrder: string[]) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, columnOrder: newOrder }
      }
    });
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const newVisible = visible
      ? [...visibleColumns, columnId]
      : visibleColumns.filter(id => id !== columnId);
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, visibleColumns: newVisible }
      }
    });
  };

  const handleColumnReset = () => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: {
          ...user?.preferences?.viewSettings?.devices,
          columnOrder: DEFAULT_DEVICE_COLUMN_ORDER,
          visibleColumns: DEFAULT_DEVICE_VISIBLE_COLUMNS
        }
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
    if (!user) return;

    runLoad(async () => {
      const [deviceData, models] = await Promise.all([
        getDevices(),
        getDeviceModels()
      ]);
      setDevices(deviceData);
      setDeviceModels(models);
    });
  }, [user]);

  const handleEdit = (device: Device) => {
    setEditingId(device.id);
    setEditValue(device.label);
    // Use model.slug if available, otherwise empty (model slug is what dropdown uses)
    setEditType(device.model?.slug || '');
  };

  const handleSave = async (device: Device) => {
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

  const handleDelete = async (device: Device) => {
    try {
      setDeleteError(null);
      await deleteDevice(device.id);
      setDevices(prev => prev.filter(d => d.id !== device.id));
      setDeleteConfirmId(null);
    } catch (error) {
      log.error('Failed to delete device', { error });
      setDeleteError(extractErrorMessage(error, 'Failed to delete device'));
    }
  };

  // Get wallet count for a device
  const getWalletCount = (device: Device): number => {
    return device.walletCount ?? device.wallets?.length ?? 0;
  };

  // Filter and sort devices based on current settings
  const sortedDevices = useMemo(() => {
    if (!devices.length) return devices;

    // Apply ownership filter
    let filtered = devices;
    if (ownershipFilter === 'owned') {
      filtered = devices.filter(d => d.isOwner === true);
    } else if (ownershipFilter === 'shared') {
      filtered = devices.filter(d => d.isOwner === false);
    }

    return [...filtered].sort((a, b) => {
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
          comparison = (a.walletCount ?? a.wallets?.length ?? 0) - (b.walletCount ?? b.wallets?.length ?? 0);
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [devices, sortBy, sortOrder, ownershipFilter]);

  // Count owned and shared devices
  const ownedCount = devices.filter(d => d.isOwner === true).length;
  const sharedCount = devices.filter(d => d.isOwner === false).length;

  // Group devices by Type
  const groupedDevices = devices.reduce((acc, device) => {
    const type = device.type as HardwareDevice;
    if (!acc[type]) acc[type] = [];
    acc[type].push(device);
    return acc;
  }, {} as Record<HardwareDevice, Device[]>);

  // Get display name for device type (looks up model name from slug)
  const getDeviceDisplayName = (type: string): string => {
    const model = deviceModels.find(m => m.slug === type);
    return model ? model.name : type || 'Unknown Device';
  };

  // Create devices for ConfigurableTable (type alias for clarity)
  const devicesWithWallets: DeviceWithWallets[] = sortedDevices;

  // Create cell renderers with current state
  const cellRenderers = useMemo(
    () => createDeviceCellRenderers(
      { editingId, editValue, editType, setEditingId, setEditValue, setEditType },
      { deleteConfirmId, deleteError, setDeleteConfirmId, setDeleteError },
      { handleEdit, handleSave, handleDelete },
      { getDeviceDisplayName, deviceModels }
    ),
    [editingId, editValue, editType, deleteConfirmId, deleteError, deviceModels]
  );

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
            {/* Ownership Filter */}
            {sharedCount > 0 && (
              <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                <button
                  onClick={() => setOwnershipFilter('all')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${ownershipFilter === 'all' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                  title="Show all devices"
                >
                  All ({devices.length})
                </button>
                <button
                  onClick={() => setOwnershipFilter('owned')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${ownershipFilter === 'owned' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                  title="Show owned devices only"
                >
                  <User className="w-3 h-3" />
                  Owned ({ownedCount})
                </button>
                <button
                  onClick={() => setOwnershipFilter('shared')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${ownershipFilter === 'shared' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                  title="Show shared devices only"
                >
                  <Users className="w-3 h-3" />
                  Shared ({sharedCount})
                </button>
              </div>
            )}
            {/* View Mode Toggle */}
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
                {/* Column Config - only in list view */}
                {viewMode === 'list' && (
                  <ColumnConfigButton
                    columns={DEVICE_COLUMNS}
                    columnOrder={columnOrder}
                    visibleColumns={visibleColumns}
                    onOrderChange={handleColumnOrderChange}
                    onVisibilityChange={handleColumnVisibilityChange}
                    onReset={handleColumnReset}
                    defaultOrder={DEFAULT_DEVICE_COLUMN_ORDER}
                    defaultVisible={DEFAULT_DEVICE_VISIBLE_COLUMNS}
                  />
                )}
            </div>
            <Button onClick={() => navigate('/devices/connect')}>
                <Plus className="w-4 h-4 mr-2" />
                Connect New Device
            </Button>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'list' && (
        <ConfigurableTable<DeviceWithWallets>
          columns={DEVICE_COLUMNS}
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          data={devicesWithWallets}
          keyExtractor={(device) => device.id}
          cellRenderers={cellRenderers}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={(field) => setSortBy(field as SortField)}
          onRowClick={(device) => navigate(`/devices/${device.id}`)}
          emptyMessage="No devices found"
        />
      )}

      {/* Grouped View */}
      {viewMode === 'grouped' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 animate-fade-in">
           {(Object.entries(groupedDevices) as [string, Device[]][]).map(([type, groupDevices]) => {
              const deviceType = type as HardwareDevice;
              return (
                <div key={type} className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 surface-secondary flex items-center justify-between">
                       <div className="flex items-center space-x-3">
                          <div className="p-2 bg-white dark:bg-sanctuary-700 rounded-lg shadow-sm text-sanctuary-600 dark:text-sanctuary-300">
                             {getDeviceIcon(deviceType, "w-6 h-6")}
                          </div>
                          <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{getDeviceDisplayName(type)}</h3>
                       </div>
                       <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
                          {groupDevices.length}
                       </span>
                    </div>
                    
                    {/* Device List */}
                    <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
                        <ul className="space-y-3">
                           {groupDevices.map(device => {
                              const walletCount = getWalletCount(device);
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
                                                <div className="flex flex-col">
                                                  <div className="flex items-center group">
                                                    <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate mr-2">{device.label}</span>
                                                    {device.isOwner && (
                                                      <>
                                                        <button onClick={(e) => { e.stopPropagation(); handleEdit(device); }} className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-sanctuary-600 transition-opacity"><Edit2 className="w-3 h-3" /></button>
                                                        {walletCount === 0 && (
                                                          <button
                                                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(device.id); }}
                                                            className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-rose-600 transition-opacity ml-1"
                                                            title="Delete device"
                                                          >
                                                            <Trash2 className="w-3 h-3" />
                                                          </button>
                                                        )}
                                                      </>
                                                    )}
                                                  </div>
                                                  {!device.isOwner && device.sharedBy && (
                                                    <span className="text-[10px] text-sanctuary-400 flex items-center gap-1">
                                                      <Users className="w-2.5 h-2.5" />
                                                      Shared by {device.sharedBy}
                                                    </span>
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

                                     {/* Wallet badges - color coded by type */}
                                     <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-sanctuary-50 dark:border-sanctuary-800">
                                         {device.wallets && device.wallets.length > 0 ? (
                                             device.wallets.map((wd) => {
                                               const walletType = wd.wallet.type || 'single_sig';
                                               const isMultisig = walletType === 'multi_sig';
                                               const badgeClass = isMultisig
                                                 ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                                                 : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';
                                               return (
                                                 <span
                                                   key={wd.wallet.id}
                                                   className={`text-[10px] px-1.5 py-0.5 rounded flex items-center ${badgeClass}`}
                                                 >
                                                   {getWalletIcon(walletType, 'w-2 h-2 mr-1 flex-shrink-0')}
                                                   {wd.wallet.name}
                                                 </span>
                                               );
                                             })
                                         ) : walletCount > 0 ? (
                                             <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center bg-primary-100 text-primary-800 border border-primary-200 dark:bg-primary-500/10 dark:text-primary-300 dark:border-primary-500/20">
                                                 <HardDrive className="w-2 h-2 mr-1 flex-shrink-0" />
                                                 {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
                                             </span>
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