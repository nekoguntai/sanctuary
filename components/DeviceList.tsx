import React, { useEffect, useState } from 'react';
import { WalletType, HardwareDevice } from '../types';
import { getDevices, updateDevice, deleteDevice, Device as ApiDevice } from '../src/api/devices';
import { Edit2, Save, X, HardDrive, Plus, LayoutGrid, List as ListIcon, Trash2 } from 'lucide-react';
import { getDeviceIcon } from './ui/CustomIcons';
import { Button } from './ui/Button';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';

const log = createLogger('DeviceList');

type ViewMode = 'list' | 'grouped';

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
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const { user } = useUser();

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Delete state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        const deviceData = await getDevices();
        setDevices(deviceData as DeviceWithWallets[]);
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
  };

  const handleSave = async (device: DeviceWithWallets) => {
    try {
      await updateDevice(device.id, { label: editValue });
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, label: editValue } : d));
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

      {/* List View */}
      {viewMode === 'list' && (
        <div className="grid gap-4">
          {devices.map((device) => {
            const associatedWallets = getAssociatedWallets(device);
            const isEditing = editingId === device.id;

            return (
              <div key={device.id} className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 flex flex-col md:flex-row md:items-center justify-between shadow-sm animate-fade-in">
                 <div className="flex items-start space-x-4 mb-4 md:mb-0">
                    <div className="p-3 rounded-xl surface-secondary text-sanctuary-600 dark:text-sanctuary-300">
                      {getDeviceIcon(device.type as HardwareDevice, "w-6 h-6")}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                         {isEditing ? (
                           <div className="flex items-center space-x-2">
                             <input 
                               type="text" 
                               value={editValue}
                               onChange={(e) => setEditValue(e.target.value)}
                               className="px-2 py-1 border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                               autoFocus
                             />
                             <button onClick={() => handleSave(device)} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors"><Save className="w-4 h-4" /></button>
                             <button onClick={() => setEditingId(null)} className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors"><X className="w-4 h-4" /></button>
                           </div>
                         ) : (
                           <>
                             <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">{device.label}</h3>
                             <button onClick={() => handleEdit(device)} className="text-sanctuary-400 hover:text-sanctuary-600"><Edit2 className="w-3 h-3" /></button>
                           </>
                         )}
                      </div>
                      <div className="text-sm text-sanctuary-500 font-mono mt-1">
                        {device.type} • <span className="surface-secondary px-1 rounded text-xs">{device.fingerprint}</span>
                      </div>
                    </div>
                 </div>

                 <div className="flex items-center space-x-4">
                    <div className="flex flex-col md:items-end">
                      <span className="text-xs font-medium text-sanctuary-400 uppercase mb-2">Used in Wallets</span>
                      <div className="flex flex-wrap gap-2">
                        {associatedWallets.length > 0 ? (
                          associatedWallets.map(w => {
                            const isMultisig = w.type === WalletType.MULTI_SIG;
                            const badgeClass = isMultisig
                              ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                              : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                            return (
                              <span key={w.id} className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${badgeClass}`}>
                                <HardDrive className="w-3 h-3 mr-1" />
                                {w.name}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-xs text-sanctuary-400 italic">Unused</span>
                        )}
                      </div>
                    </div>

                    {/* Delete Button - only show for unused devices */}
                    {associatedWallets.length === 0 && (
                      <div className="relative">
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
                 </div>
              </div>
            );
          })}
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
                                 <li key={device.id} className="p-3 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800 hover:border-sanctuary-300 dark:hover:border-sanctuary-600 transition-colors surface-elevated">
                                     <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1 min-w-0">
                                            {isEditing ? (
                                                <div className="flex items-center space-x-1 mb-1">
                                                    <input 
                                                        type="text" 
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted focus:outline-none"
                                                        autoFocus
                                                    />
                                                    <button onClick={() => handleSave(device)} className="p-1 text-emerald-600"><Save className="w-3 h-3" /></button>
                                                    <button onClick={() => setEditingId(null)} className="p-1 text-rose-600"><X className="w-3 h-3" /></button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center group">
                                                    <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate mr-2">{device.label}</span>
                                                    <button onClick={() => handleEdit(device)} className="opacity-0 group-hover:opacity-100 text-sanctuary-400 hover:text-sanctuary-600 transition-opacity"><Edit2 className="w-3 h-3" /></button>
                                                    {associatedWallets.length === 0 && (
                                                      <button
                                                        onClick={() => setDeleteConfirmId(device.id)}
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
                                          <div className="flex items-center space-x-1">
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