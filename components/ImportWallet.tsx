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
  Shield,
  Usb,
  Loader2
} from 'lucide-react';
import { createLogger } from '../utils/logger';
import * as hardwareWallet from '../services/hardwareWallet';
import { DeviceType } from '../services/hardwareWallet';
import { useSidebar } from '../contexts/SidebarContext';

const log = createLogger('ImportWallet');

type ImportFormat = 'descriptor' | 'json' | 'hardware';
type ScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
type HardwareDeviceType = 'ledger' | 'trezor';

// Helper: Compute derivation path from script type and account
const getDerivationPath = (scriptType: ScriptType, account: number): string => {
  const purpose: Record<ScriptType, number> = {
    native_segwit: 84,
    nested_segwit: 49,
    taproot: 86,
    legacy: 44,
  };
  return `m/${purpose[scriptType]}'/0'/${account}'`;
};

// Helper: Build descriptor from xpub data
const buildDescriptorFromXpub = (
  scriptType: ScriptType,
  fingerprint: string,
  path: string,
  xpub: string
): string => {
  const pathParts = path.replace("m/", "").replace(/'/g, "h");
  switch (scriptType) {
    case 'native_segwit':
      return `wpkh([${fingerprint}/${pathParts}]${xpub}/0/*)`;
    case 'nested_segwit':
      return `sh(wpkh([${fingerprint}/${pathParts}]${xpub}/0/*))`;
    case 'taproot':
      return `tr([${fingerprint}/${pathParts}]${xpub}/0/*)`;
    case 'legacy':
      return `pkh([${fingerprint}/${pathParts}]${xpub}/0/*)`;
    default:
      return `wpkh([${fingerprint}/${pathParts}]${xpub}/0/*)`;
  }
};

export const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const { refreshSidebar } = useSidebar();
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

  // Hardware Import State
  const [hardwareDeviceType, setHardwareDeviceType] = useState<HardwareDeviceType>('ledger');
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [scriptType, setScriptType] = useState<ScriptType>('native_segwit');
  const [accountIndex, setAccountIndex] = useState(0);
  const [xpubData, setXpubData] = useState<{ xpub: string; fingerprint: string; path: string } | null>(null);
  const [isFetchingXpub, setIsFetchingXpub] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hardwareError, setHardwareError] = useState<string | null>(null);

  // Validate data when moving from step 2 to step 3
  // Accepts optional dataOverride for cases where state hasn't updated yet (e.g., hardware wallet)
  const validateData = async (dataOverride?: string) => {
    setIsValidating(true);
    setValidationError(null);

    const dataToValidate = dataOverride || importData;

    try {
      // Send data based on selected format - server auto-detects wallet export format
      // For hardware format, we send as descriptor since we built one from the xpub
      const result = await walletsApi.validateImport({
        descriptor: (format === 'descriptor' || format === 'hardware') ? dataToValidate : undefined,
        json: format === 'json' ? dataToValidate : undefined,
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
    } else if (step === 2) {
      if (format === 'hardware') {
        // Build descriptor from hardware xpub data
        if (!xpubData) return;
        const descriptor = buildDescriptorFromXpub(
          scriptType,
          xpubData.fingerprint,
          xpubData.path,
          xpubData.xpub
        );
        setImportData(descriptor);
        // Validate with descriptor directly (state update is async)
        const isValid = await validateData(descriptor);
        if (isValid) {
          setStep(3);
        }
      } else if (importData.trim()) {
        const isValid = await validateData();
        if (isValid) {
          setStep(3);
        }
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
      if (step === 2) {
        // Clear hardware state when going back to format selection
        setDeviceConnected(false);
        setDeviceLabel(null);
        setXpubData(null);
        setHardwareError(null);
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

      // Refresh sidebar to show new wallet
      refreshSidebar();

      // Navigate to the new wallet
      navigate(`/wallets/${result.wallet.id}`);
    } catch (error) {
      log.error('Failed to import wallet', { error });
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              Import using a Bitcoin output descriptor string. Standard format used by Bitcoin Core.
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
            <h3 className="text-lg font-medium">JSON/Text File</h3>
            <p className="text-sm text-sanctuary-500 mt-2">
              Import using a JSON or text file with wallet details. Supports Sparrow exports.
            </p>
          </div>
        </button>

        <button
          onClick={() => setFormat('hardware')}
          className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${
            format === 'hardware'
              ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
              : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
          }`}
        >
          <div className={`p-4 rounded-full ${
            format === 'hardware'
              ? 'bg-primary-100 text-primary-600'
              : 'bg-sanctuary-100 text-sanctuary-400'
          }`}>
            <Usb className="w-12 h-12" />
          </div>
          <div>
            <h3 className="text-lg font-medium">Hardware Device</h3>
            <p className="text-sm text-sanctuary-500 mt-2">
              Connect a Ledger or Trezor device to import wallet directly from xpub.
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
        {format === 'descriptor' ? 'Enter Output Descriptor' : 'Enter Configuration'}
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        {format === 'descriptor'
          ? 'Paste your Bitcoin output descriptor or upload a file.'
          : 'Paste your wallet configuration or upload a JSON/text file.'}
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
          className={`w-full px-4 py-3 rounded-xl border surface-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm ${
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
          <div className="text-xs text-sanctuary-500 surface-secondary p-4 rounded-lg">
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

  // Hardware device connection handler
  const handleConnectDevice = async () => {
    setIsConnecting(true);
    setHardwareError(null);

    try {
      // Connect using the selected device type
      const device = await hardwareWallet.hardwareWalletService.connect(hardwareDeviceType as DeviceType);
      setDeviceConnected(true);
      setDeviceLabel(device.name || (hardwareDeviceType === 'trezor' ? 'Trezor Device' : 'Ledger Device'));
    } catch (error) {
      log.error('Failed to connect hardware device', { error });
      setHardwareError(error instanceof Error ? error.message : 'Failed to connect device');
    } finally {
      setIsConnecting(false);
    }
  };

  // Fetch xpub from connected device
  const handleFetchXpub = async () => {
    if (!deviceConnected) return;

    setIsFetchingXpub(true);
    setHardwareError(null);

    try {
      const path = getDerivationPath(scriptType, accountIndex);
      // Use the service which routes to the correct device implementation
      const result = await hardwareWallet.hardwareWalletService.getXpub(path);

      if (result.xpub && result.fingerprint) {
        setXpubData({
          xpub: result.xpub,
          fingerprint: result.fingerprint,
          path: path
        });
      } else {
        setHardwareError('Failed to retrieve xpub from device');
      }
    } catch (error) {
      log.error('Failed to fetch xpub', { error });
      setHardwareError(error instanceof Error ? error.message : 'Failed to fetch xpub');
    } finally {
      setIsFetchingXpub(false);
    }
  };

  // Script type options
  const scriptTypeOptions: { value: ScriptType; label: string; description: string }[] = [
    { value: 'native_segwit', label: 'Native SegWit', description: 'bc1q... addresses (Recommended)' },
    { value: 'nested_segwit', label: 'Nested SegWit', description: '3... addresses' },
    { value: 'taproot', label: 'Taproot', description: 'bc1p... addresses' },
    { value: 'legacy', label: 'Legacy', description: '1... addresses' },
  ];

  // Step 2 (Hardware): Device Connection & Path Selection
  const renderStep2Hardware = () => {
    // Check if Ledger is supported (requires HTTPS)
    const ledgerSupported = hardwareWallet.isSecureContext();

    return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        Connect Hardware Device
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        Select your device type and connect via USB.
      </p>

      <div className="space-y-6">
        {/* Device Type Selection */}
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">
            Device Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                if (ledgerSupported) {
                  setHardwareDeviceType('ledger');
                  setDeviceConnected(false);
                  setXpubData(null);
                }
              }}
              disabled={!ledgerSupported}
              className={`p-4 rounded-lg border text-left transition-colors ${
                hardwareDeviceType === 'ledger'
                  ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : !ledgerSupported
                    ? 'border-sanctuary-200 dark:border-sanctuary-700 opacity-50 cursor-not-allowed'
                    : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
              }`}
            >
              <p className={`text-sm font-medium ${
                hardwareDeviceType === 'ledger'
                  ? 'text-primary-700 dark:text-primary-400'
                  : 'text-sanctuary-900 dark:text-sanctuary-100'
              }`}>
                Ledger
              </p>
              <p className="text-xs text-sanctuary-500 mt-0.5">
                {ledgerSupported ? 'Nano S, S Plus, X, Stax, Flex' : 'Requires HTTPS connection'}
              </p>
            </button>
            <button
              onClick={() => {
                setHardwareDeviceType('trezor');
                setDeviceConnected(false);
                setXpubData(null);
              }}
              className={`p-4 rounded-lg border text-left transition-colors ${
                hardwareDeviceType === 'trezor'
                  ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
              }`}
            >
              <p className={`text-sm font-medium ${
                hardwareDeviceType === 'trezor'
                  ? 'text-primary-700 dark:text-primary-400'
                  : 'text-sanctuary-900 dark:text-sanctuary-100'
              }`}>
                Trezor
              </p>
              <p className="text-xs text-sanctuary-500 mt-0.5">One, Model T, Safe 3/5/7</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Via Trezor Suite</p>
            </button>
          </div>
        </div>

        {/* Trezor workflow notice */}
        {hardwareDeviceType === 'trezor' && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium mb-1">Trezor Suite Required</p>
              <p className="text-amber-700 dark:text-amber-300">
                You'll need to switch between Sanctuary and Trezor Suite to approve requests on your device.
                Keep Trezor Suite open and check it when prompted.
              </p>
            </div>
          </div>
        )}

        {/* Device Connection */}
        <div className="surface-secondary rounded-xl p-6">
          {!deviceConnected ? (
            <div className="text-center">
              <div className="mx-auto w-16 h-16 surface-elevated rounded-full flex items-center justify-center mb-4">
                <Usb className="w-8 h-8 text-sanctuary-400" />
              </div>
              <p className="text-sm text-sanctuary-500 mb-4">
                {hardwareDeviceType === 'trezor'
                  ? 'Make sure Trezor Suite desktop app is running and your device is connected.'
                  : 'Make sure your Ledger is connected and the Bitcoin app is open.'}
              </p>
              <Button
                onClick={handleConnectDevice}
                isLoading={isConnecting}
                disabled={isConnecting || (hardwareDeviceType === 'ledger' && !ledgerSupported)}
              >
                {isConnecting ? 'Connecting...' : 'Connect Device'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success-100 dark:bg-success-900/30 rounded-full flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-success-600 dark:text-success-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  {deviceLabel}
                </p>
                <p className="text-xs text-success-600 dark:text-success-400">Connected</p>
              </div>
            </div>
          )}
        </div>

        {deviceConnected && (
          <>
            {/* Script Type Selection */}
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">
                Script Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                {scriptTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setScriptType(option.value);
                      setXpubData(null); // Clear xpub when script type changes
                    }}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      scriptType === option.value
                        ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                        : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
                    }`}
                  >
                    <p className={`text-sm font-medium ${
                      scriptType === option.value
                        ? 'text-primary-700 dark:text-primary-400'
                        : 'text-sanctuary-900 dark:text-sanctuary-100'
                    }`}>
                      {option.label}
                    </p>
                    <p className="text-xs text-sanctuary-500 mt-0.5">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Account Index */}
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                Account Index
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={accountIndex}
                onChange={(e) => {
                  setAccountIndex(Math.max(0, parseInt(e.target.value) || 0));
                  setXpubData(null); // Clear xpub when account changes
                }}
                className="w-32 px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-sanctuary-500 mt-1">
                Use 0 for first account, 1 for second, etc.
              </p>
            </div>

            {/* Derivation Path Display */}
            <div className="surface-secondary rounded-lg p-4">
              <p className="text-xs text-sanctuary-500 mb-1">Derivation Path</p>
              <p className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100">
                {getDerivationPath(scriptType, accountIndex)}
              </p>
            </div>

            {/* Fetch Xpub Button */}
            <div className="text-center">
              <Button
                onClick={handleFetchXpub}
                isLoading={isFetchingXpub}
                disabled={isFetchingXpub}
                variant="secondary"
              >
                {isFetchingXpub ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Fetching from device...
                  </>
                ) : xpubData ? (
                  'Fetch Again'
                ) : (
                  'Fetch Xpub from Device'
                )}
              </Button>
            </div>

            {/* Xpub Result */}
            {xpubData && (
              <div className="surface-secondary rounded-xl p-4 border border-success-200 dark:border-success-800">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-4 h-4 text-success-600 dark:text-success-400" />
                  <p className="text-sm font-medium text-success-700 dark:text-success-400">
                    Xpub Retrieved Successfully
                  </p>
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-sanctuary-500">Fingerprint</p>
                    <p className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100">
                      {xpubData.fingerprint}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-sanctuary-500">Extended Public Key</p>
                    <p className="font-mono text-xs text-sanctuary-700 dark:text-sanctuary-300 break-all">
                      {xpubData.xpub.substring(0, 20)}...{xpubData.xpub.substring(xpubData.xpub.length - 20)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Error Display */}
        {hardwareError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{hardwareError}</span>
          </div>
        )}
      </div>
    </div>
    );
  };

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

  // Step 4: Review & Confirm
  const renderStep4 = () => {
    if (!validationResult) return null;

    const devicesToCreate = validationResult.devices.filter(d => d.willCreate);
    const devicesToReuse = validationResult.devices.filter(d => !d.willCreate);

    return (
      <div className="space-y-6 animate-fade-in max-w-lg mx-auto text-center">
        <div className="mx-auto w-16 h-16 surface-secondary rounded-full flex items-center justify-center mb-4">
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

        <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden text-left">
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
          {step === 2 && format === 'hardware' && renderStep2Hardware()}
          {step === 2 && format !== 'hardware' && renderStep2()}
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
                (step === 2 && format !== 'hardware' && !importData.trim()) ||
                (step === 2 && format === 'hardware' && !xpubData) ||
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
