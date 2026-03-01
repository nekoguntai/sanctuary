import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Upload,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { ApiError } from '../../src/api/client';
import { createLogger } from '../../utils/logger';
import { useImportWallet } from '../../hooks/queries/useWallets';
import { useImportState } from './hooks/useImportState';
import { buildDescriptorFromXpub, validateImportData } from './importHelpers';
import { FormatSelection } from './steps/FormatSelection';
import { DescriptorInput } from './steps/DescriptorInput';
import { HardwareImport } from './steps/HardwareImport';
import { QrScanStep } from './steps/QrScanStep';
import { DeviceResolutionStep } from './DeviceResolution';
import { ImportReview } from './ImportReview';

const log = createLogger('ImportWallet');

export const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const importWalletMutation = useImportWallet();
  const state = useImportState();

  // Validate data when moving from step 2 to step 3
  // Accepts optional dataOverride for cases where state hasn't updated yet (e.g., hardware wallet)
  const validateData = async (dataOverride?: string) => {
    state.setIsValidating(true);
    try {
      return await validateImportData(
        state.format,
        state.importData,
        state.walletName,
        state.setValidationResult,
        state.setValidationError,
        state.setWalletName,
        dataOverride,
      );
    } finally {
      state.setIsValidating(false);
    }
  };

  const handleNext = async () => {
    if (state.step === 1 && state.format) {
      state.setStep(2);
    } else if (state.step === 2) {
      if (state.format === 'hardware') {
        // Build descriptor from hardware xpub data
        if (!state.xpubData) return;
        const descriptor = buildDescriptorFromXpub(
          state.scriptType,
          state.xpubData.fingerprint,
          state.xpubData.path,
          state.xpubData.xpub
        );
        state.setImportData(descriptor);
        // Validate with descriptor directly (state update is async)
        const isValid = await validateData(descriptor);
        if (isValid) {
          state.setStep(3);
        }
      } else if (state.format === 'qr_code' && state.qrScanned && state.importData.trim()) {
        // QR code data is already in importData - validate as JSON
        const isValid = await validateData();
        if (isValid) {
          state.setStep(3);
        }
      } else if (state.importData.trim()) {
        const isValid = await validateData();
        if (isValid) {
          state.setStep(3);
        }
      }
    } else if (state.step === 3 && state.walletName.trim()) {
      state.setStep(4);
    }
  };

  const handleBack = () => {
    if (state.step > 1) {
      state.setStep(state.step - 1);
      if (state.step === 3) {
        // Clear validation when going back to input
        state.resetValidation();
      }
      if (state.step === 2) {
        // Clear hardware state when going back to format selection
        state.resetHardwareState();
        // Clear QR state
        state.resetQrState();
      }
    } else {
      navigate('/wallets');
    }
  };

  const handleImport = async () => {
    state.setIsImporting(true);
    state.setImportError(null);

    try {
      const result = await importWalletMutation.mutateAsync({
        data: state.importData,
        name: state.walletName.trim(),
        network: state.network,
      });

      // Navigate to the new wallet (React Query automatically invalidates wallet list)
      navigate(`/wallets/${result.wallet.id}`);
    } catch (error) {
      log.error('Failed to import wallet', { error });
      if (error instanceof ApiError) {
        state.setImportError(error.message);
      } else {
        state.setImportError('Failed to import wallet. Please try again.');
      }
    } finally {
      state.setIsImporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-12">
      {/* Header Navigation */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={handleBack}
          className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {state.step === 1 ? 'Cancel' : 'Back'}
        </button>
        <div className="flex space-x-2">
          {[1, 2, 3, 4].map(s => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all duration-300 ${
                s === state.step
                  ? 'w-8 bg-sanctuary-800 dark:bg-sanctuary-200'
                  : s < state.step
                    ? 'w-2 bg-success-500'
                    : 'w-2 bg-sanctuary-200 dark:bg-sanctuary-800'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="min-h-[400px] flex flex-col justify-between">
        {/* Step Content */}
        <div className="flex-1">
          {state.step === 1 && (
            <FormatSelection
              format={state.format}
              setFormat={state.setFormat}
            />
          )}
          {state.step === 2 && state.format === 'hardware' && (
            <HardwareImport
              hardwareDeviceType={state.hardwareDeviceType}
              setHardwareDeviceType={state.setHardwareDeviceType}
              deviceConnected={state.deviceConnected}
              setDeviceConnected={state.setDeviceConnected}
              deviceLabel={state.deviceLabel}
              setDeviceLabel={state.setDeviceLabel}
              scriptType={state.scriptType}
              setScriptType={state.setScriptType}
              accountIndex={state.accountIndex}
              setAccountIndex={state.setAccountIndex}
              xpubData={state.xpubData}
              setXpubData={state.setXpubData}
              isFetchingXpub={state.isFetchingXpub}
              setIsFetchingXpub={state.setIsFetchingXpub}
              isConnecting={state.isConnecting}
              setIsConnecting={state.setIsConnecting}
              hardwareError={state.hardwareError}
              setHardwareError={state.setHardwareError}
            />
          )}
          {state.step === 2 && state.format === 'qr_code' && (
            <QrScanStep
              cameraActive={state.cameraActive}
              setCameraActive={state.setCameraActive}
              cameraError={state.cameraError}
              setCameraError={state.setCameraError}
              urProgress={state.urProgress}
              setUrProgress={state.setUrProgress}
              qrScanned={state.qrScanned}
              setQrScanned={state.setQrScanned}
              setImportData={state.setImportData}
              validationError={state.validationError}
              setValidationError={state.setValidationError}
              bytesDecoderRef={state.bytesDecoderRef}
            />
          )}
          {state.step === 2 && state.format !== 'hardware' && state.format !== 'qr_code' && (
            <DescriptorInput
              format={state.format}
              importData={state.importData}
              setImportData={state.setImportData}
              validationError={state.validationError}
              setValidationError={state.setValidationError}
            />
          )}
          {state.step === 3 && state.validationResult && (
            <DeviceResolutionStep
              validationResult={state.validationResult}
              walletName={state.walletName}
              setWalletName={state.setWalletName}
              network={state.network}
              setNetwork={state.setNetwork}
            />
          )}
          {state.step === 4 && state.validationResult && (
            <ImportReview
              validationResult={state.validationResult}
              walletName={state.walletName}
              network={state.network}
              importError={state.importError}
            />
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-8 pt-8 border-t border-sanctuary-200 dark:border-sanctuary-800 flex justify-end">
          {state.step < 4 ? (
            <Button
              size="lg"
              onClick={handleNext}
              isLoading={state.isValidating}
              disabled={
                (state.step === 1 && !state.format) ||
                (state.step === 2 && state.format === 'descriptor' && !state.importData.trim()) ||
                (state.step === 2 && state.format === 'json' && !state.importData.trim()) ||
                (state.step === 2 && state.format === 'hardware' && !state.xpubData) ||
                (state.step === 2 && state.format === 'qr_code' && !state.qrScanned) ||
                (state.step === 3 && !state.walletName.trim()) ||
                state.isValidating
              }
            >
              {state.isValidating ? 'Validating...' : 'Next Step'}
              {!state.isValidating && <ArrowRight className="w-4 h-4 ml-2" />}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={handleImport}
              isLoading={state.isImporting}
            >
              <Upload className="w-4 h-4 mr-2" /> Import Wallet
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
