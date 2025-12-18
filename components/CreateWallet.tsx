import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as walletsApi from '../src/api/wallets';
import * as devicesApi from '../src/api/devices';
import { Device, WalletType, Wallet } from '../types';
import { Button } from './ui/Button';
import { SingleSigIcon, MultiSigIcon, getDeviceIcon } from './ui/CustomIcons';
import { ArrowLeft, ArrowRight, Check, Plus, Cpu, Shield, Settings, CheckCircle } from 'lucide-react';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { createLogger } from '../utils/logger';
import { useCreateWallet } from '../hooks/queries/useWallets';

const log = createLogger('CreateWallet');

export const CreateWallet: React.FC = () => {
  const navigate = useNavigate();
  const { handleError } = useErrorHandler();
  const createWalletMutation = useCreateWallet();
  const [step, setStep] = useState(1);
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  
  // Form State
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [walletName, setWalletName] = useState('');
  const [scriptType, setScriptType] = useState<'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy'>('native_segwit');
  const [quorumM, setQuorumM] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadDevices = async () => {
      try {
        const apiDevices = await devicesApi.getDevices();
        // Convert API devices to component format
        const formatted: Device[] = apiDevices.map(d => ({
          id: d.id,
          type: d.type,
          label: d.label,
          fingerprint: d.fingerprint,
          derivationPath: d.derivationPath || "m/84'/0'/0'",
          xpub: d.xpub,
          userId: '', // Not needed in frontend
        }));
        setAvailableDevices(formatted);
      } catch (error) {
        log.error('Failed to load devices', { error });
        setAvailableDevices([]);
      }
    };

    loadDevices();
  }, []);

  const toggleDevice = (id: string) => {
    const next = new Set(selectedDeviceIds);
    if (walletType === WalletType.SINGLE_SIG) {
        // For single sig, behave like radio button
        next.clear();
        next.add(id);
    } else {
        // For multi sig, behave like checkbox
        if (next.has(id)) next.delete(id);
        else next.add(id);
    }
    setSelectedDeviceIds(next);
  };

  const handleNext = () => {
    if (step === 1 && walletType) setStep(2);
    else if (step === 2 && selectedDeviceIds.size > 0) {
        // Validate M-of-N on transition
        if (walletType === WalletType.MULTI_SIG && selectedDeviceIds.size < 2) {
            handleError('Multisig requires at least 2 devices.', 'Validation Error');
            return;
        }
        setStep(3);
    } 
    else if (step === 3 && walletName) setStep(4);
  };

  const handleCreate = async () => {
    setIsSubmitting(true);

    try {
      // Create wallet via API with device IDs
      // The backend will automatically generate descriptors from device xpubs
      const created = await createWalletMutation.mutateAsync({
        name: walletName,
        type: walletType === WalletType.SINGLE_SIG ? 'single_sig' : 'multi_sig',
        scriptType: scriptType,
        network: 'mainnet',
        quorum: walletType === WalletType.MULTI_SIG ? quorumM : undefined,
        totalSigners: walletType === WalletType.MULTI_SIG ? selectedDeviceIds.size : undefined,
        deviceIds: Array.from(selectedDeviceIds),
      });

      // Navigate to wallet detail page (React Query automatically invalidates wallet list)
      navigate(`/wallets/${created.id}`);
    } catch (error) {
      log.error('Failed to create wallet', { error });
      handleError(error, 'Failed to Create Wallet');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- RENDER STEPS ---

  const renderStep1 = () => (
    <div className="space-y-6 animate-fade-in">
        <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-8">Select Wallet Topology</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button 
                onClick={() => setWalletType(WalletType.SINGLE_SIG)}
                className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${walletType === WalletType.SINGLE_SIG ? 'border-emerald-600 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-900/20' : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'}`}
            >
                <div className={`p-4 rounded-full ${walletType === WalletType.SINGLE_SIG ? 'bg-emerald-100 text-emerald-600' : 'bg-sanctuary-100 text-sanctuary-400'}`}>
                    <SingleSigIcon className="w-12 h-12" />
                </div>
                <div>
                    <h3 className="text-lg font-medium">Single Signature</h3>
                    <p className="text-sm text-sanctuary-500 mt-2">Standard wallet. Requires one device to sign transactions. Simple and effective for daily use.</p>
                </div>
            </button>

            <button
                onClick={() => setWalletType(WalletType.MULTI_SIG)}
                className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${walletType === WalletType.MULTI_SIG ? 'border-warning-600 bg-warning-50 dark:border-warning-400 dark:bg-warning-900/20' : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'}`}
            >
                <div className={`p-4 rounded-full ${walletType === WalletType.MULTI_SIG ? 'bg-warning-100 text-warning-600' : 'bg-sanctuary-100 text-sanctuary-400'}`}>
                    <MultiSigIcon className="w-12 h-12" />
                </div>
                <div>
                    <h3 className="text-lg font-medium">Multi Signature</h3>
                    <p className="text-sm text-sanctuary-500 mt-2">Enhanced security. Requires M of N devices to sign. Best for long-term cold storage and team custody.</p>
                </div>
            </button>
        </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6 animate-fade-in">
        <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">Select Signers</h2>
        <p className="text-center text-sanctuary-500 mb-6">
            {walletType === WalletType.SINGLE_SIG ? "Select the device that will control this wallet." : "Select the devices that will participate in this multisig quorum."}
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
            {availableDevices.map(device => {
                const isSelected = selectedDeviceIds.has(device.id);
                return (
                    <div 
                        key={device.id}
                        onClick={() => toggleDevice(device.id)}
                        className={`cursor-pointer p-4 rounded-xl border flex items-center justify-between transition-all ${isSelected ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500' : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'}`}
                    >
                        <div className="flex items-center space-x-3">
                            <div className="text-sanctuary-500">{getDeviceIcon(device.type, "w-6 h-6")}</div>
                            <div>
                                <h4 className="font-medium text-sm">{device.label}</h4>
                                <p className="text-xs text-sanctuary-400 font-mono">{device.fingerprint}</p>
                            </div>
                        </div>
                        {isSelected && <CheckCircle className="w-5 h-5 text-sanctuary-800 dark:text-sanctuary-200" />}
                    </div>
                );
            })}
             {/* Add New Device Option */}
             <button 
                onClick={() => navigate('/devices/connect')}
                className="p-4 rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700 flex items-center justify-center text-sanctuary-500 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors"
             >
                <Plus className="w-5 h-5 mr-2" />
                <span className="text-sm font-medium">Connect New Device</span>
             </button>
        </div>
        <div className="text-center text-xs text-sanctuary-400 mt-2">
            Don't see your device? Click "Connect New Device" above to add it to Sanctuary.
        </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6 animate-fade-in max-w-lg mx-auto">
        <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-6">Configuration</h2>
        
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Wallet Name</label>
                <input 
                    type="text" 
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    placeholder={walletType === WalletType.SINGLE_SIG ? "e.g., My ColdCard Wallet" : "e.g., Family Savings"}
                    className="w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                    autoFocus
                />
            </div>

            {walletType === WalletType.SINGLE_SIG && (
                <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Script Type</label>
                    <div className="grid grid-cols-1 gap-2">
                        {[
                            { id: 'native_segwit', label: 'Native Segwit (Bech32)', desc: 'bc1q... (Lowest fees, Recommended)' },
                            { id: 'taproot', label: 'Taproot (Bech32m)', desc: 'bc1p... (Advanced privacy)' },
                            { id: 'nested_segwit', label: 'Nested Segwit (P2SH)', desc: '3... (High compatibility)' },
                            { id: 'legacy', label: 'Legacy (P2PKH)', desc: '1... (Oldest)' },
                        ].map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setScriptType(opt.id as any)}
                                className={`text-left p-3 rounded-lg border flex items-center justify-between ${scriptType === opt.id ? 'border-sanctuary-600 bg-sanctuary-50 dark:border-sanctuary-400 dark:bg-sanctuary-800' : 'border-sanctuary-200 dark:border-sanctuary-800'}`}
                            >
                                <div>
                                    <div className="text-sm font-medium">{opt.label}</div>
                                    <div className="text-xs text-sanctuary-500">{opt.desc}</div>
                                </div>
                                {scriptType === opt.id && <Check className="w-4 h-4 text-sanctuary-600 dark:text-sanctuary-400" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {walletType === WalletType.MULTI_SIG && (
                <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Quorum (M of N)</label>
                    <div className="surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
                        <div className="flex justify-between items-center mb-4">
                            <span className="text-sm">Required Signatures: <span className="font-bold">{quorumM}</span></span>
                            <span className="text-sm text-sanctuary-500">Total Signers: {selectedDeviceIds.size}</span>
                        </div>
                        <input 
                            type="range" 
                            min="1" 
                            max={selectedDeviceIds.size} 
                            value={quorumM} 
                            onChange={(e) => setQuorumM(parseInt(e.target.value))}
                            className="w-full accent-sanctuary-800 dark:accent-sanctuary-200"
                        />
                        <p className="text-xs text-sanctuary-500 mt-2">
                            {quorumM} out of {selectedDeviceIds.size} devices will be required to spend funds.
                        </p>
                    </div>
                </div>
            )}
        </div>
    </div>
  );

  const renderStep4 = () => (
     <div className="space-y-6 animate-fade-in max-w-lg mx-auto text-center">
         <div className="mx-auto w-16 h-16 surface-secondary rounded-full flex items-center justify-center mb-4">
             <Shield className="w-8 h-8 text-sanctuary-600 dark:text-sanctuary-300" />
         </div>
         <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Review Wallet Details</h2>
         
         <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden text-left">
             <div className="px-6 py-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
                 <h3 className="text-lg font-medium">{walletName}</h3>
             </div>
             <dl className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
                 <div className="px-6 py-4 grid grid-cols-2 gap-4">
                     <dt className="text-sm text-sanctuary-500">Type</dt>
                     <dd className="text-sm font-medium">{walletType}</dd>
                 </div>
                 {walletType === WalletType.SINGLE_SIG ? (
                     <div className="px-6 py-4 grid grid-cols-2 gap-4">
                        <dt className="text-sm text-sanctuary-500">Script</dt>
                        <dd className="text-sm font-medium capitalize">{scriptType.replace('_', ' ')}</dd>
                     </div>
                 ) : (
                     <div className="px-6 py-4 grid grid-cols-2 gap-4">
                        <dt className="text-sm text-sanctuary-500">Quorum</dt>
                        <dd className="text-sm font-medium">{quorumM} of {selectedDeviceIds.size}</dd>
                     </div>
                 )}
                 <div className="px-6 py-4">
                     <dt className="text-sm text-sanctuary-500 mb-2">Signers</dt>
                     <dd className="text-sm font-medium space-y-1">
                         {Array.from(selectedDeviceIds).map(id => {
                             const dev = availableDevices.find(d => d.id === id);
                             return (
                                 <div key={id} className="flex items-center">
                                     <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></span>
                                     {dev?.label} ({dev?.type})
                                 </div>
                             );
                         })}
                     </dd>
                 </div>
             </dl>
         </div>
     </div>
  );

  return (
    <div className="max-w-4xl mx-auto pb-12">
        {/* Header Navigation */}
        <div className="flex items-center justify-between mb-8">
            <button 
                onClick={() => { if(step > 1) setStep(step-1); else navigate('/wallets'); }}
                className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
            >
                <ArrowLeft className="w-4 h-4 mr-1" /> {step === 1 ? 'Cancel' : 'Back'}
            </button>
            <div className="flex space-x-2">
                {[1, 2, 3, 4].map(s => (
                    <div 
                        key={s} 
                        className={`h-2 rounded-full transition-all duration-300 ${s === step ? 'w-8 bg-sanctuary-800 dark:bg-sanctuary-200' : s < step ? 'w-2 bg-emerald-500' : 'w-2 bg-sanctuary-200 dark:bg-sanctuary-800'}`}
                    />
                ))}
            </div>
        </div>

        <div className="min-h-[400px] flex flex-col justify-between">
            {/* Step Content */}
            <div className="flex-1">
                {step === 1 && renderStep1()}
                {step === 2 && renderStep2()}
                {step === 3 && renderStep3()}
                {step === 4 && renderStep4()}
            </div>

            {/* Footer Actions */}
            <div className="mt-8 pt-8 border-t border-sanctuary-200 dark:border-sanctuary-800 flex justify-end">
                {step < 4 ? (
                    <Button 
                        size="lg" 
                        onClick={handleNext} 
                        disabled={
                            (step === 1 && !walletType) || 
                            (step === 2 && selectedDeviceIds.size === 0) ||
                            (step === 3 && !walletName)
                        }
                    >
                        Next Step <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                ) : (
                    <Button 
                        size="lg" 
                        onClick={handleCreate} 
                        isLoading={isSubmitting}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
                    >
                        <Check className="w-4 h-4 mr-2" /> Construct Wallet
                    </Button>
                )}
            </div>
        </div>
    </div>
  );
};