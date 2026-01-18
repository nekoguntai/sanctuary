/**
 * UsbConnectionPanel Component
 *
 * Displays USB connection UI with progress indicator and status feedback.
 */

import React from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { getDeviceIcon } from '../ui/CustomIcons';
import { getDeviceTypeFromModel } from '../../utils/deviceConnection';
import { UsbConnectionPanelProps } from './types';

export const UsbConnectionPanel: React.FC<UsbConnectionPanelProps> = ({
  selectedModel,
  scanning,
  scanned,
  error,
  usbProgress,
  parsedAccountsCount,
  fingerprint,
  onConnect,
}) => {
  const deviceType = getDeviceTypeFromModel(selectedModel);

  return (
    <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
      {/* Initial State */}
      {!scanning && !scanned && !error && (
        <>
          <div className="mx-auto text-sanctuary-400 mb-3 flex justify-center">
            {getDeviceIcon(selectedModel.name, "w-12 h-12")}
          </div>
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-2">
            Connect your {selectedModel.name} via USB and unlock it.
          </p>
          {deviceType === 'trezor' ? (
            <p className="text-xs text-sanctuary-400 mb-4">
              Requires <span className="font-medium">Trezor Suite</span> desktop app to be running.
            </p>
          ) : (
            <p className="text-xs text-sanctuary-400 mb-4">
              Make sure the Bitcoin app is open on your device.
            </p>
          )}
          <Button onClick={onConnect}>
            Connect Device
          </Button>
        </>
      )}

      {/* Error State */}
      {!scanning && !scanned && error && (
        <>
          <div className="mx-auto text-rose-400 mb-3 flex justify-center">
            <AlertCircle className="w-12 h-12" />
          </div>
          <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
            {error}
          </p>
          <Button onClick={onConnect}>
            Try Again
          </Button>
        </>
      )}

      {/* Scanning State */}
      {scanning && (
        <div className="flex flex-col items-center">
          <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
          {usbProgress ? (
            <>
              <p className="text-sm text-sanctuary-500">
                Fetching {usbProgress.name}...
              </p>
              <p className="text-xs text-sanctuary-400 mt-1">
                {usbProgress.current} of {usbProgress.total} derivation paths
              </p>
              <div className="w-48 mt-3 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full h-2">
                <div
                  className="bg-sanctuary-600 dark:bg-sanctuary-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(usbProgress.current / usbProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-sanctuary-400 mt-2">Confirm each path on your device</p>
            </>
          ) : (
            <>
              <p className="text-sm text-sanctuary-500">Connecting to device...</p>
              <p className="text-xs text-sanctuary-400 mt-1">Please confirm on your device if prompted.</p>
            </>
          )}
        </div>
      )}

      {/* Success State */}
      {scanned && !error && (
        <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
          <Check className="w-10 h-10 mb-2" />
          <p className="font-medium">Device Connected</p>
          <p className="text-xs text-sanctuary-500 mt-1">
            {parsedAccountsCount > 0
              ? `${parsedAccountsCount} derivation paths fetched`
              : `Fingerprint: ${fingerprint}`
            }
          </p>
        </div>
      )}
    </div>
  );
};
