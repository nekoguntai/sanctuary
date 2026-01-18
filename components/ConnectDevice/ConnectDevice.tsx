/**
 * ConnectDevice Orchestrator Component
 *
 * Main component for connecting hardware wallet devices.
 * Orchestrates the multi-step flow:
 * 1. Select device model
 * 2. Choose connection method (USB, SD Card, QR, Manual)
 * 3. Enter device details
 * 4. Save device (with conflict handling)
 *
 * This is a refactored version that delegates state to custom hooks
 * and UI to subcomponents for better maintainability.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { HardwareDeviceModel, DeviceAccountInput } from '../../src/api/devices';
import { DeviceAccount, parseDeviceJson } from '../../services/deviceParsers';
import { isSecureContext } from '../../services/hardwareWallet';

// Hooks
import { useDeviceModels } from '../../hooks/useDeviceModels';
import { useDeviceSave } from '../../hooks/useDeviceSave';
import { useQrScanner, QrScanResult } from '../../hooks/useQrScanner';
import { useDeviceConnection } from '../../hooks/useDeviceConnection';

// Utilities
import {
  getAvailableMethods,
  normalizeDerivationPath,
} from '../../utils/deviceConnection';

// Subcomponents
import { DeviceModelSelector } from './DeviceModelSelector';
import { ConnectionMethodSelector } from './ConnectionMethodSelector';
import { UsbConnectionPanel } from './UsbConnectionPanel';
import { QrScannerPanel } from './QrScannerPanel';
import { FileUploadPanel } from './FileUploadPanel';
import { DeviceDetailsForm } from './DeviceDetailsForm';
import { ConflictDialog } from './ConflictDialog';
import { ConnectionMethod, DeviceFormData } from './types';

export const ConnectDevice: React.FC = () => {
  const navigate = useNavigate();

  // Device model selection
  const {
    filteredModels,
    manufacturers,
    loading: loadingModels,
    error: modelsError,
    selectedManufacturer,
    searchQuery,
    setSelectedManufacturer,
    setSearchQuery,
    clearFilters,
  } = useDeviceModels();

  // Device save operations
  const {
    saving,
    merging,
    error: saveError,
    conflictData,
    saveDevice,
    mergeDevice,
    clearConflict,
    reset: resetSave,
  } = useDeviceSave();

  // QR scanning
  const {
    qrMode,
    setQrMode,
    cameraActive,
    setCameraActive,
    cameraError,
    urProgress,
    scanning: qrScanning,
    scanResult,
    error: qrError,
    handleQrScan,
    handleCameraError,
    handleFileContent,
    reset: resetQr,
    stopCamera,
  } = useQrScanner();

  // USB device connection
  const {
    scanning: usbScanning,
    usbProgress,
    connectionResult,
    error: usbError,
    connectUsb,
    reset: resetUsb,
  } = useDeviceConnection();

  // Local UI state
  const [selectedModel, setSelectedModel] = useState<HardwareDeviceModel | null>(null);
  const [method, setMethod] = useState<ConnectionMethod | null>(null);
  const [scanned, setScanned] = useState(false);
  const [fileScanning, setFileScanning] = useState(false);

  // Device form data
  const [formData, setFormData] = useState<DeviceFormData>({
    label: '',
    xpub: '',
    fingerprint: '',
    derivationPath: "m/84'/0'/0'",
    parsedAccounts: [],
    selectedAccounts: new Set(),
  });

  // QR extraction tracking
  const [qrExtractedFields, setQrExtractedFields] = useState<{
    xpub: boolean;
    fingerprint: boolean;
    derivationPath: boolean;
    label: boolean;
  } | null>(null);
  const [showQrDetails, setShowQrDetails] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // Reset state when model changes
  useEffect(() => {
    setMethod(null);
    setScanned(false);
    resetQr();
    resetUsb();
    resetSave();
    setQrExtractedFields(null);
    setWarning(null);
    setFormData({
      label: selectedModel ? `My ${selectedModel.name}` : '',
      xpub: '',
      fingerprint: '',
      derivationPath: "m/84'/0'/0'",
      parsedAccounts: [],
      selectedAccounts: new Set(),
    });
  }, [selectedModel, resetQr, resetUsb, resetSave]);

  // Apply QR scan result to form
  useEffect(() => {
    if (scanResult) {
      applyParseResult(scanResult);
      setScanned(true);
    }
  }, [scanResult]);

  // Apply USB connection result to form
  useEffect(() => {
    if (connectionResult) {
      setFormData(prev => ({
        ...prev,
        fingerprint: connectionResult.fingerprint,
        parsedAccounts: connectionResult.accounts,
        selectedAccounts: new Set(connectionResult.accounts.map((_, i) => i)),
      }));
      setScanned(true);
    }
  }, [connectionResult]);

  /**
   * Apply parsed device data to form
   */
  const applyParseResult = useCallback((result: QrScanResult | {
    xpub?: string;
    fingerprint?: string;
    derivationPath?: string;
    label?: string;
    accounts?: DeviceAccount[];
  }) => {
    setFormData(prev => {
      const updates: Partial<DeviceFormData> = {};

      if ('extractedFields' in result) {
        // QR scan result
        updates.xpub = result.xpub;
        updates.fingerprint = result.fingerprint;
        if (result.derivationPath) {
          updates.derivationPath = result.derivationPath;
        }
        if (result.label && !prev.label.startsWith('My ')) {
          updates.label = result.label;
        }
        if (result.accounts && result.accounts.length > 0) {
          updates.parsedAccounts = result.accounts;
          updates.selectedAccounts = new Set(result.accounts.map((_, i) => i));
        }

        setQrExtractedFields(result.extractedFields);
        setWarning(result.warning);
      } else {
        // File parse result
        if (result.xpub) updates.xpub = result.xpub;
        if (result.fingerprint) updates.fingerprint = result.fingerprint;
        if (result.derivationPath) {
          updates.derivationPath = normalizeDerivationPath(result.derivationPath);
        }
        if (result.label && !prev.label.startsWith('My ')) {
          updates.label = result.label;
        }
        if (result.accounts && result.accounts.length > 0) {
          updates.parsedAccounts = result.accounts;
          updates.selectedAccounts = new Set(result.accounts.map((_, i) => i));
        }
      }

      return { ...prev, ...updates };
    });
  }, []);

  /**
   * Handle file upload for SD card / QR file mode
   */
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileScanning(true);
    setWarning(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = parseDeviceJson(content);

      if (result && (result.xpub || result.fingerprint || result.accounts?.length)) {
        applyParseResult(result);
        setScanned(true);
      } else {
        setWarning('Could not parse file. Please check the format.');
      }
      setFileScanning(false);
    };
    reader.onerror = () => {
      setWarning('Failed to read file.');
      setFileScanning(false);
    };
    reader.readAsText(file);
  }, [applyParseResult]);

  /**
   * Update form data
   */
  const handleFormDataChange = useCallback((updates: Partial<DeviceFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  /**
   * Toggle account selection
   */
  const handleToggleAccount = useCallback((index: number) => {
    setFormData(prev => {
      const newSelected = new Set(prev.selectedAccounts);
      if (newSelected.has(index)) {
        newSelected.delete(index);
      } else {
        newSelected.add(index);
      }
      return { ...prev, selectedAccounts: newSelected };
    });
  }, []);

  /**
   * Handle method selection
   */
  const handleSelectMethod = useCallback((newMethod: ConnectionMethod) => {
    setMethod(newMethod);
    setScanned(false);
    setWarning(null);
    setQrExtractedFields(null);
    resetQr();
    resetUsb();
  }, [resetQr, resetUsb]);

  /**
   * Handle save
   */
  const handleSave = useCallback(async () => {
    if (!selectedModel) return;

    // Build accounts array from selected parsed accounts
    const accounts: DeviceAccountInput[] = [];
    if (formData.parsedAccounts.length > 0 && formData.selectedAccounts.size > 0) {
      formData.parsedAccounts.forEach((account, index) => {
        if (formData.selectedAccounts.has(index)) {
          accounts.push({
            purpose: account.purpose,
            scriptType: account.scriptType,
            derivationPath: account.derivationPath,
            xpub: account.xpub,
          });
        }
      });
    }

    await saveDevice({
      type: selectedModel.name,
      label: formData.label || `${selectedModel.name} ${formData.fingerprint}`,
      fingerprint: formData.fingerprint || '00000000',
      ...(accounts.length > 0
        ? { accounts }
        : { xpub: formData.xpub, derivationPath: formData.derivationPath }
      ),
      modelSlug: selectedModel.slug,
    });
  }, [selectedModel, formData, saveDevice]);

  /**
   * Handle merge
   */
  const handleMerge = useCallback(async () => {
    if (!selectedModel) return;

    const accounts: DeviceAccountInput[] = [];
    if (formData.parsedAccounts.length > 0 && formData.selectedAccounts.size > 0) {
      formData.parsedAccounts.forEach((account, index) => {
        if (formData.selectedAccounts.has(index)) {
          accounts.push({
            purpose: account.purpose,
            scriptType: account.scriptType,
            derivationPath: account.derivationPath,
            xpub: account.xpub,
          });
        }
      });
    }

    await mergeDevice({
      type: selectedModel.name,
      label: formData.label || `${selectedModel.name} ${formData.fingerprint}`,
      fingerprint: formData.fingerprint || '00000000',
      ...(accounts.length > 0
        ? { accounts }
        : { xpub: formData.xpub, derivationPath: formData.derivationPath }
      ),
      modelSlug: selectedModel.slug,
    });
  }, [selectedModel, formData, mergeDevice]);

  // Get available methods for selected model
  const availableMethods = selectedModel
    ? getAvailableMethods(selectedModel.connectivity, isSecureContext())
    : [];

  // Combined scanning state
  const scanning = usbScanning || qrScanning || fileScanning;

  // Combined error
  const error = saveError || qrError || usbError || modelsError;

  // Loading state
  if (loadingModels) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-sanctuary-500" />
        <span className="ml-3 text-sanctuary-500">Loading device models...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Back Button */}
      <button
        onClick={() => navigate('/devices')}
        className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Devices
      </button>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">Connect Hardware Device</h1>
        <p className="text-sanctuary-500">Add a new signing device to your sanctuary.</p>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Steps 1 & 2 */}
        <div className="lg:col-span-2 space-y-4">
          {/* Step 1: Device Model Selection */}
          <DeviceModelSelector
            models={filteredModels}
            manufacturers={manufacturers}
            selectedModel={selectedModel}
            selectedManufacturer={selectedManufacturer}
            searchQuery={searchQuery}
            onSelectModel={setSelectedModel}
            onSelectManufacturer={setSelectedManufacturer}
            onSearchChange={setSearchQuery}
            onClearFilters={clearFilters}
          />

          {/* Step 2: Connection Method */}
          {selectedModel && (
            <ConnectionMethodSelector
              selectedModel={selectedModel}
              selectedMethod={method}
              availableMethods={availableMethods}
              onSelectMethod={handleSelectMethod}
            />
          )}

          {/* Connection Action Area */}
          {selectedModel && method && (
            <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
              {method === 'usb' && (
                <UsbConnectionPanel
                  selectedModel={selectedModel}
                  scanning={usbScanning}
                  scanned={scanned}
                  error={usbError}
                  usbProgress={usbProgress}
                  parsedAccountsCount={formData.parsedAccounts.length}
                  fingerprint={formData.fingerprint}
                  onConnect={() => connectUsb(selectedModel)}
                />
              )}

              {method === 'sd_card' && (
                <FileUploadPanel
                  selectedModel={selectedModel}
                  scanning={fileScanning}
                  scanned={scanned}
                  onFileUpload={handleFileUpload}
                />
              )}

              {method === 'qr_code' && (
                <QrScannerPanel
                  selectedModel={selectedModel}
                  scanned={scanned}
                  qrMode={qrMode}
                  cameraActive={cameraActive}
                  cameraError={cameraError}
                  urProgress={urProgress}
                  scanning={qrScanning}
                  fingerprint={formData.fingerprint}
                  isSecure={isSecureContext()}
                  onQrModeChange={setQrMode}
                  onCameraActiveChange={setCameraActive}
                  onQrScan={handleQrScan}
                  onCameraError={handleCameraError}
                  onFileUpload={handleFileUpload}
                  onStopCamera={stopCamera}
                />
              )}

              {method === 'manual' && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl flex items-start">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-3 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Manually entering xpubs is for advanced users. Ensure you copy the correct Extended Public Key
                    corresponding to the derivation path. The fingerprint should match your device's master fingerprint.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Step 3 */}
        <div className="space-y-4">
          <DeviceDetailsForm
            selectedModel={selectedModel}
            method={method}
            scanned={scanned}
            formData={formData}
            saving={saving}
            error={error}
            warning={warning}
            qrExtractedFields={qrExtractedFields}
            showQrDetails={showQrDetails}
            onFormDataChange={handleFormDataChange}
            onToggleAccount={handleToggleAccount}
            onToggleQrDetails={() => setShowQrDetails(!showQrDetails)}
            onSave={handleSave}
          />
        </div>
      </div>

      {/* Conflict Dialog */}
      {conflictData && (
        <ConflictDialog
          conflictData={conflictData}
          merging={merging}
          error={saveError}
          onMerge={handleMerge}
          onViewExisting={() => navigate(`/devices/${conflictData.existingDevice.id}`)}
          onCancel={clearConflict}
        />
      )}
    </div>
  );
};
