import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as walletsApi from '../src/api/wallets';
import { ImportValidationResult, DeviceResolution } from '../src/api/wallets';
import { ApiError } from '../src/api/client';
import { Button } from './ui/Button';
import { SingleSigIcon, MultiSigIcon, getDeviceIcon } from './ui/CustomIcons';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileJson,
  FileText,
  AlertCircle,
  CheckCircle,
  PlusCircle,
  RefreshCw,
  Upload,
  Shield
} from 'lucide-react';

type ImportFormat = 'descriptor' | 'json';

export const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Form State
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [importData, setImportData] = useState('');
  const [walletName, setWalletName] = useState('');
  const [network, setNetwork] = useState<'mainnet' | 'testnet' | 'regtest'>('mainnet');

  // Validation State
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Validate data when moving from step 2 to step 3
  const validateData = async () => {
    setIsValidating(true);
    setValidationError(null);

    try {
      // Send data based on selected format - server auto-detects wallet export format
      const result = await walletsApi.validateImport({
        descriptor: format === 'descriptor' ? importData : undefined,
        json: format === 'json' ? importData : undefined,
      });

      if (!result.valid) {
        setValidationError(result.error || 'Invalid import data');
        return false;
      }

      setValidationResult(result);

      // Auto-fill wallet name from suggested name if available and name is empty
      if (result.suggestedName && !walletName) {
        setWalletName(result.suggestedName);
      }

      return true;
    } catch (error) {
      if (error instanceof ApiError) {
        setValidationError(error.message);
      } else {
        setValidationError('Failed to validate import data');
      }
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handleNext = async () => {
    if (step === 1 && format) {
      setStep(2);
    } else if (step === 2 && importData.trim()) {
      const isValid = await validateData();
      if (isValid) {
        setStep(3);
      }
    } else if (step === 3 && walletName.trim()) {
      setStep(4);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      if (step === 3) {
        // Clear validation when going back to input
        setValidationResult(null);
        setValidationError(null);
      }
    } else {
      navigate('/wallets');
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    setImportError(null);

    try {
      const result = await walletsApi.importWallet({
        data: importData,
        name: walletName.trim(),
        network,
      });

      // Navigate to the new wallet
      navigate(`/wallets/${result.wallet.id}`);
    } catch (error) {
      console.error('Failed to import wallet:', error);
      if (error instanceof ApiError) {
        setImportError(error.message);
      } else {
        setImportError('Failed to import wallet. Please try again.');
      }
    } finally {
      setIsImporting(false);
    }
  };

  // Step 1: Select Format
  const renderStep1 = () => (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-8">
        Select Import Format
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          onClick={() => setFormat('descriptor')}
          className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${
            format === 'descriptor'
              ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
              : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
          }`}
        >
          <div className={`p-4 rounded-full ${
            format === 'descriptor'
              ? 'bg-primary-100 text-primary-600'
              : 'bg-sanctuary-100 text-sanctuary-400'
          }`}>
            <FileText className="w-12 h-12" />
          </div>
          <div>
            <h3 className="text-lg font-medium">Output Descriptor</h3>
            <p className="text-sm text-sanctuary-500 mt-2">
              Import using a Bitcoin output descriptor string. Standard format used by Bitcoin Core and hardware wallets.
            </p>
          </div>
        </button>

        <button
          onClick={() => setFormat('json')}
          className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${
            format === 'json'
              ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
              : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
          }`}
        >
          <div className={`p-4 rounded-full ${
            format === 'json'
              ? 'bg-primary-100 text-primary-600'
              : 'bg-sanctuary-100 text-sanctuary-400'
          }`}>
            <FileJson className="w-12 h-12" />
          </div>
          <div>
            <h3 className="text-lg font-medium">JSON Configuration</h3>
            <p className="text-sm text-sanctuary-500 mt-2">
              Import using a JSON file with wallet and device details. Includes device labels and types.
            </p>
          </div>
        </button>
      </div>
    </div>
  );

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportData(content);
      setValidationError(null);
    };
    reader.onerror = () => {
      setValidationError('Failed to read file');
    };
    reader.readAsText(file);
  };

  // Step 2: Input Data
  const renderStep2 = () => (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        {format === 'descriptor' ? 'Enter Output Descriptor' : 'Enter JSON Configuration'}
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        {format === 'descriptor'
          ? 'Paste your Bitcoin output descriptor or upload a file.'
          : 'Paste your JSON wallet configuration or upload a file.'}
      </p>

      <div className="space-y-4">
        {/* File Upload Area */}
        <div className="relative">
          <input
            type="file"
            accept={format === 'json' ? '.json,.txt' : '.txt'}
            onChange={handleFileUpload}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="flex items-center justify-center gap-2 w-full px-4 py-3 border-2 border-dashed border-sanctuary-300 dark:border-sanctuary-700 rounded-xl cursor-pointer hover:border-primary-500 dark:hover:border-primary-500 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50 transition-colors"
          >
            <Upload className="w-5 h-5 text-sanctuary-400" />
            <span className="text-sm text-sanctuary-500">
              Click to upload {format === 'json' ? '.json or .txt' : '.txt'} file
            </span>
          </label>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-sanctuary-200 dark:bg-sanctuary-700" />
          <span className="text-xs text-sanctuary-400">or paste below</span>
          <div className="flex-1 h-px bg-sanctuary-200 dark:bg-sanctuary-700" />
        </div>

        <textarea
          value={importData}
          onChange={(e) => {
            setImportData(e.target.value);
            setValidationError(null);
          }}
          placeholder={format === 'descriptor'
            ? 'wpkh([a1b2c3d4/84h/0h/0h]xpub6E.../0/*)'
            : '{\n  "type": "multi_sig",\n  "scriptType": "native_segwit",\n  "quorum": 2,\n  "devices": [...]\n}'}
          rows={10}
          className={`w-full px-4 py-3 rounded-xl border bg-white dark:bg-sanctuary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm ${
            validationError
              ? 'border-red-500 dark:border-red-400'
              : 'border-sanctuary-300 dark:border-sanctuary-700'
          }`}
        />

        {validationError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{validationError}</span>
          </div>
        )}

        {format === 'json' && (
          <div className="text-xs text-sanctuary-500 bg-sanctuary-50 dark:bg-sanctuary-800/50 p-4 rounded-lg">
            <p className="font-medium mb-2">Expected JSON format:</p>
            <pre className="overflow-x-auto">{`{
  "type": "single_sig" | "multi_sig",
  "scriptType": "native_segwit" | "nested_segwit" | "taproot" | "legacy",
  "quorum": 2,  // For multi_sig only
  "devices": [
    {
      "type": "coldcard",
      "label": "My ColdCard",
      "fingerprint": "a1b2c3d4",
      "derivationPath": "m/48'/0'/0'/2'",
      "xpub": "xpub6E..."
    }
  ]
}`}</pre>
          </div>
        )}
      </div>
    </div>
  );

  // Step 3: Configuration & Device Preview
  const renderStep3 = () => {
    if (!validationResult) return null;

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
              className="w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                      ? 'border-primary-600 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/20 dark:text-primary-400'
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
          <div className="bg-sanctuary-50 dark:bg-sanctuary-800/50 rounded-xl p-4 space-y-3">
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
                <p className="font-medium">
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

  // Step 4: Review & Confirm
  const renderStep4 = () => {
    if (!validationResult) return null;

    const devicesToCreate = validationResult.devices.filter(d => d.willCreate);
    const devicesToReuse = validationResult.devices.filter(d => !d.willCreate);

    return (
      <div className="space-y-6 animate-fade-in max-w-lg mx-auto text-center">
        <div className="mx-auto w-16 h-16 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-full flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-sanctuary-600 dark:text-sanctuary-300" />
        </div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">
          Confirm Import
        </h2>

        {importError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-left">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{importError}</span>
          </div>
        )}

        <div className="bg-white dark:bg-sanctuary-900 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden text-left">
          <div className="px-6 py-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
            <h3 className="text-lg font-medium">{walletName}</h3>
          </div>
          <dl className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
            <div className="px-6 py-4 grid grid-cols-2 gap-4">
              <dt className="text-sm text-sanctuary-500">Type</dt>
              <dd className="text-sm font-medium capitalize">
                {validationResult.walletType === 'multi_sig'
                  ? `${validationResult.quorum}-of-${validationResult.totalSigners} Multisig`
                  : 'Single Signature'}
              </dd>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-4">
              <dt className="text-sm text-sanctuary-500">Script Type</dt>
              <dd className="text-sm font-medium capitalize">
                {validationResult.scriptType.replace('_', ' ')}
              </dd>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-4">
              <dt className="text-sm text-sanctuary-500">Network</dt>
              <dd className="text-sm font-medium capitalize">{network}</dd>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-4">
              <dt className="text-sm text-sanctuary-500">Import Format</dt>
              <dd className="text-sm font-medium capitalize">{validationResult.format}</dd>
            </div>
            <div className="px-6 py-4">
              <dt className="text-sm text-sanctuary-500 mb-2">Devices</dt>
              <dd className="text-sm space-y-1">
                {devicesToReuse.length > 0 && (
                  <div className="flex items-center text-sanctuary-600 dark:text-sanctuary-400">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {devicesToReuse.length} existing device{devicesToReuse.length > 1 ? 's' : ''} will be reused
                  </div>
                )}
                {devicesToCreate.length > 0 && (
                  <div className="flex items-center text-success-600 dark:text-success-400">
                    <PlusCircle className="w-4 h-4 mr-2" />
                    {devicesToCreate.length} new device{devicesToCreate.length > 1 ? 's' : ''} will be created
                  </div>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    );
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
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        <div className="flex space-x-2">
          {[1, 2, 3, 4].map(s => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all duration-300 ${
                s === step
                  ? 'w-8 bg-sanctuary-800 dark:bg-sanctuary-200'
                  : s < step
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
              isLoading={isValidating}
              disabled={
                (step === 1 && !format) ||
                (step === 2 && !importData.trim()) ||
                (step === 3 && !walletName.trim()) ||
                isValidating
              }
            >
              {isValidating ? 'Validating...' : 'Next Step'}
              {!isValidating && <ArrowRight className="w-4 h-4 ml-2" />}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={handleImport}
              isLoading={isImporting}
            >
              <Upload className="w-4 h-4 mr-2" /> Import Wallet
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// Device Card Component
const DeviceCard: React.FC<{ device: DeviceResolution; isReused: boolean }> = ({ device, isReused }) => (
  <div className={`p-3 rounded-lg border flex items-center justify-between ${
    isReused
      ? 'border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900'
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
