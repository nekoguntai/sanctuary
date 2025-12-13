import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WalletType, HardwareDevice } from '../types';
import { getDevice, updateDevice, Device as ApiDevice } from '../src/api/devices';
import { getDeviceIcon, getWalletIcon } from './ui/CustomIcons';
import { Edit2, Save, X, ArrowLeft } from 'lucide-react';
import { useUser } from '../contexts/UserContext';

// Extended device type with wallet info
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

// Wallet info for display
interface WalletInfo {
  id: string;
  name: string;
  type: WalletType;
}

export const DeviceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<DeviceWithWallets | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useUser();

  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !user) return;
      try {
        const deviceData = await getDevice(id) as DeviceWithWallets;
        setDevice(deviceData);
        // Extract wallet info from device data
        const walletList = deviceData.wallets?.map(w => ({
          id: w.wallet.id,
          name: w.wallet.name,
          type: w.wallet.type === 'MULTI_SIG' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG
        })) || [];
        setWallets(walletList);
        setEditLabel(deviceData.label);
      } catch (error) {
        console.error('Failed to fetch device:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, user]);

  const handleSave = async () => {
    if (!device) return;
    try {
      await updateDevice(device.id, { label: editLabel });
      setDevice({ ...device, label: editLabel });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update device:', error);
    }
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
                                        <button onClick={handleSave} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors"><Save className="w-5 h-5" /></button>
                                        <button onClick={() => { setIsEditing(false); setEditLabel(device.label); }} className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors"><X className="w-5 h-5" /></button>
                                    </div>
                                ) : (
                                    <>
                                        <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">{device.label}</h1>
                                        <button onClick={() => setIsEditing(true)} className="text-sanctuary-400 hover:text-sanctuary-600 p-1"><Edit2 className="w-4 h-4" /></button>
                                    </>
                                )}
                            </div>
                            <p className="text-sanctuary-500 mt-1 font-mono text-sm">{device.type}</p>
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

        <div className="space-y-4">
             <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Associated Wallets</h3>
             {wallets.length === 0 ? (
                 <div className="surface-elevated rounded-xl p-8 text-center text-sanctuary-400 border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                     No wallets are currently using this device.
                 </div>
             ) : (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {wallets.map(w => {
                         const isMultisig = w.type === WalletType.MULTI_SIG;
                         const badgeClass = isMultisig 
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 dark:border dark:border-orange-700' 
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100 dark:border dark:border-emerald-700';

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
    </div>
  );
};