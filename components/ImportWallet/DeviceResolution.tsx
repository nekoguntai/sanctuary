import React from 'react';
import { ImportValidationResult, DeviceResolution as DeviceResolutionType } from '../../src/api/wallets';
import { SingleSigIcon, MultiSigIcon, getDeviceIcon } from '../ui/CustomIcons';
import {
  CheckCircle,
  PlusCircle,
  RefreshCw,
} from 'lucide-react';

const DeviceCard: React.FC<{ device: DeviceResolutionType; isReused: boolean }> = ({ device, isReused }) => (
  <div className={`p-3 rounded-lg border flex items-center justify-between ${
    isReused
      ? 'border-sanctuary-200 dark:border-sanctuary-700 surface-elevated'
      : 'border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-900/20'
  }`}>
    <div className="flex items-center gap-3">
      <div className="text-sanctuary-500">
        {getDeviceIcon(device.originalType || 'unknown', 'w-5 h-5')}
      </div>
      <div>
        <p className="text-sm font-medium">
          {isReused ? device.existingDeviceLabel : device.suggestedLabel || 'New Device'}
        </p>
        <p className="text-xs text-sanctuary-400 font-mono">{device.fingerprint}</p>
      </div>
    </div>
    {isReused ? (
      <CheckCircle className="w-4 h-4 text-sanctuary-500" />
    ) : (
      <PlusCircle className="w-4 h-4 text-success-500" />
    )}
  </div>
);

interface DeviceResolutionProps {
  validationResult: ImportValidationResult;
  walletName: string;
  setWalletName: (name: string) => void;
  network: 'mainnet' | 'testnet' | 'regtest';
  setNetwork: (network: 'mainnet' | 'testnet' | 'regtest') => void;
}

export const DeviceResolutionStep: React.FC<DeviceResolutionProps> = ({
  validationResult,
  walletName,
  setWalletName,
  network,
  setNetwork,
}) => {
  const devicesToCreate = validationResult.devices.filter(d => d.willCreate);
  const devicesToReuse = validationResult.devices.filter(d => !d.willCreate);

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-6">
        Configure Import
      </h2>

      <div className="space-y-4">
        {/* Wallet Name */}
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
            Wallet Name
          </label>
          <input
            type="text"
            value={walletName}
            onChange={(e) => setWalletName(e.target.value)}
            placeholder="e.g., Imported Multisig"
            className="w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
        </div>

        {/* Network Selection */}
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
            Network
          </label>
          <div className="flex gap-2">
            {(['mainnet', 'testnet', 'regtest'] as const).map(net => (
              <button
                key={net}
                onClick={() => setNetwork(net)}
                className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${
                  network === net
                    ? net === 'mainnet'
                      ? 'border-mainnet-500 bg-mainnet-800 text-mainnet-200 dark:border-mainnet-500 dark:bg-mainnet-100 dark:text-mainnet-800'
                      : net === 'testnet'
                      ? 'border-testnet-500 bg-testnet-800 text-testnet-200 dark:border-testnet-500 dark:bg-testnet-100 dark:text-testnet-800'
                      : 'border-signet-500 bg-signet-800 text-signet-200 dark:border-signet-500 dark:bg-signet-100 dark:text-signet-800'
                    : 'border-sanctuary-200 dark:border-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:border-sanctuary-400'
                }`}
              >
                {net.charAt(0).toUpperCase() + net.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-xs text-sanctuary-500 mt-1">
            Detected: {validationResult.network}
          </p>
        </div>

        {/* Wallet Info */}
        <div className="surface-secondary rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${
              validationResult.walletType === 'multi_sig'
                ? 'bg-warning-100 dark:bg-warning-900/30'
                : 'bg-success-100 dark:bg-success-900/30'
            }`}>
              {validationResult.walletType === 'multi_sig'
                ? <MultiSigIcon className="w-5 h-5 text-warning-600 dark:text-warning-400" />
                : <SingleSigIcon className="w-5 h-5 text-success-600 dark:text-success-400" />
              }
            </div>
            <div>
              <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {validationResult.walletType === 'multi_sig'
                  ? `${validationResult.quorum}-of-${validationResult.totalSigners} Multisig`
                  : 'Single Signature'}
              </p>
              <p className="text-xs text-sanctuary-500 capitalize">
                {validationResult.scriptType.replace('_', ' ')}
              </p>
            </div>
          </div>
        </div>

        {/* Device Preview */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
            Devices ({validationResult.devices.length})
          </h3>

          {devicesToReuse.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-sanctuary-500 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />
                Will reuse existing devices:
              </p>
              {devicesToReuse.map((device, i) => (
                <DeviceCard
                  key={device.fingerprint}
                  device={device}
                  isReused
                />
              ))}
            </div>
          )}

          {devicesToCreate.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-sanctuary-500 flex items-center gap-1">
                <PlusCircle className="w-3 h-3" />
                Will create new devices:
              </p>
              {devicesToCreate.map((device, i) => (
                <DeviceCard
                  key={device.fingerprint}
                  device={device}
                  isReused={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
