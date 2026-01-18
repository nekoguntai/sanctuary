/**
 * QrScannerPanel Component
 *
 * QR code scanning UI with camera/file toggle, progress for animated QR codes,
 * and error handling.
 */

import React from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Camera, Upload, FileJson, Loader2, Check, AlertCircle, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { QrScannerPanelProps } from './types';

export const QrScannerPanel: React.FC<QrScannerPanelProps> = ({
  selectedModel,
  scanned,
  qrMode,
  cameraActive,
  cameraError,
  urProgress,
  scanning,
  fingerprint,
  isSecure,
  onQrModeChange,
  onCameraActiveChange,
  onQrScan,
  onCameraError,
  onFileUpload,
  onStopCamera,
}) => {
  return (
    <div className="space-y-3">
      {/* QR Mode Toggle */}
      <div className="flex justify-center gap-2">
        <button
          onClick={() => onQrModeChange('camera')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            qrMode === 'camera'
              ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
              : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
          }`}
        >
          <Camera className="w-4 h-4" />
          Scan with Camera
        </button>
        <button
          onClick={() => onQrModeChange('file')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            qrMode === 'file'
              ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
              : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
          }`}
        >
          <Upload className="w-4 h-4" />
          Upload File
        </button>
      </div>

      {/* Camera Scanner */}
      {qrMode === 'camera' && !scanned && (
        <div className="surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
          {/* Initial Camera State */}
          {!cameraActive && !cameraError && (
            <div className="text-center py-8">
              <Camera className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
                Point your camera at the QR code on your {selectedModel.name}.
              </p>
              {!isSecure && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 px-4">
                  Camera access requires HTTPS. Please use https://localhost:8443
                </p>
              )}
              <Button onClick={() => onCameraActiveChange(true)}>
                Start Camera
              </Button>
            </div>
          )}

          {/* Active Camera */}
          {cameraActive && (
            <div className="relative">
              <div className="aspect-square max-w-sm mx-auto">
                <Scanner
                  onScan={onQrScan}
                  onError={onCameraError}
                  constraints={{ facingMode: 'environment' }}
                  scanDelay={100}
                  styles={{
                    container: { width: '100%', height: '100%' },
                    video: { width: '100%', height: '100%', objectFit: 'cover' },
                  }}
                />
              </div>
              <button
                onClick={onStopCamera}
                className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Progress overlay for animated QR codes */}
              {urProgress > 0 && urProgress < 100 && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-3 z-10">
                  <div className="flex items-center justify-between text-white mb-2">
                    <span className="flex items-center text-sm font-medium">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Scanning animated QR...
                    </span>
                    <span className="text-lg font-bold">{urProgress}%</span>
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-2">
                    <div
                      className="bg-green-400 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${urProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-center text-white/70 mt-2">
                    Keep camera pointed at animated QR code
                  </p>
                </div>
              )}

              {urProgress === 0 && (
                <p className="text-xs text-center text-sanctuary-500 py-2">
                  Position the QR code within the frame
                </p>
              )}
            </div>
          )}

          {/* Camera Error */}
          {cameraError && (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
              <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
                {cameraError}
              </p>
              <Button onClick={() => onCameraActiveChange(true)}>
                Try Again
              </Button>
            </div>
          )}
        </div>
      )}

      {/* File Upload (alternative) */}
      {qrMode === 'file' && !scanned && (
        <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
          {!scanning && (
            <>
              <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
                Upload a file containing your QR code data (JSON or text export).
              </p>
              <label className="cursor-pointer">
                <span className="inline-flex items-center justify-center rounded-lg px-4 py-2 bg-sanctuary-800 text-sanctuary-50 text-sm font-medium hover:bg-sanctuary-700 transition-colors">
                  Select File
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".json,.txt"
                  onChange={onFileUpload}
                />
              </label>
            </>
          )}
          {scanning && (
            <div className="flex flex-col items-center">
              <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
              <p className="text-sm text-sanctuary-500">Parsing file...</p>
            </div>
          )}
        </div>
      )}

      {/* Success state */}
      {scanned && (
        <div className="text-center py-6 surface-muted rounded-xl border border-sanctuary-300 dark:border-sanctuary-700">
          <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
            <Check className="w-10 h-10 mb-2" />
            <p className="font-medium">QR Code Scanned Successfully</p>
            <p className="text-xs text-sanctuary-500 mt-1">Fingerprint: {fingerprint || 'Not provided'}</p>
          </div>
        </div>
      )}
    </div>
  );
};
