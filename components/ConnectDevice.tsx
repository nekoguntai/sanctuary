import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDevice, CreateDeviceRequest, getDeviceModels, HardwareDeviceModel } from '../src/api/devices';
import { Button } from './ui/Button';
import {
  ArrowLeft,
  Usb,
  FileJson,
  PenTool,
  Check,
  AlertCircle,
  Bluetooth,
  Wifi,
  Smartphone,
  QrCode,
  HardDrive,
  Shield,
  Code,
  Lock,
  Loader2,
  ChevronRight,
  Search,
  X
} from 'lucide-react';
import { getDeviceIcon } from './ui/CustomIcons';

type ConnectionMethod = 'usb' | 'sd_card' | 'qr_code' | 'bluetooth' | 'nfc' | 'manual';

// Map connectivity types to icons and labels
const connectivityConfig: Record<string, { icon: React.FC<{ className?: string }>, label: string, description: string }> = {
  usb: { icon: Usb, label: 'USB', description: 'Connect via USB cable' },
  bluetooth: { icon: Bluetooth, label: 'Bluetooth', description: 'Pair via Bluetooth' },
  nfc: { icon: Smartphone, label: 'NFC', description: 'Tap to connect' },
  sd_card: { icon: HardDrive, label: 'SD Card', description: 'Import from SD card file' },
  qr_code: { icon: QrCode, label: 'QR Code', description: 'Scan QR codes' },
};

export const ConnectDevice: React.FC = () => {
  const navigate = useNavigate();

  // Device models from database
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [selectedModel, setSelectedModel] = useState<HardwareDeviceModel | null>(null);

  // Group models by manufacturer for better organization
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Connection method based on device capabilities
  const [method, setMethod] = useState<ConnectionMethod | null>(null);

  // Device Details
  const [label, setLabel] = useState('');
  const [xpub, setXpub] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [derivationPath, setDerivationPath] = useState("m/84'/0'/0'");

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch device models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const models = await getDeviceModels();
        setDeviceModels(models);

        // Extract unique manufacturers
        const uniqueManufacturers = [...new Set(models.map(m => m.manufacturer))].sort();
        setManufacturers(uniqueManufacturers);
      } catch (err) {
        console.error('Failed to fetch device models:', err);
        setError('Failed to load device models. Please try again.');
      } finally {
        setLoadingModels(false);
      }
    };
    fetchModels();
  }, []);

  // Reset method when model changes
  useEffect(() => {
    setMethod(null);
    setScanned(false);
    setXpub('');
    setFingerprint('');
    if (selectedModel) {
      setLabel(`My ${selectedModel.name}`);
    }
  }, [selectedModel]);

  // Get available connection methods for selected device
  const getAvailableMethods = (): ConnectionMethod[] => {
    if (!selectedModel) return [];
    const methods: ConnectionMethod[] = [];

    // Add methods based on device connectivity, plus always allow manual
    selectedModel.connectivity.forEach(conn => {
      if (conn in connectivityConfig) {
        methods.push(conn as ConnectionMethod);
      }
    });

    // Always allow manual entry as fallback
    methods.push('manual');

    return methods;
  };

  const handleScan = () => {
    setScanning(true);
    // Simulate USB/Bluetooth scan
    setTimeout(() => {
      setScanning(false);
      setScanned(true);
      // Generate a random fingerprint for demo
      setFingerprint(Math.random().toString(16).substring(2, 10));
      setXpub(`zpub6r${Math.random().toString(36).substring(2, 15)}...`);
    }, 2000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setError(null);

    // Read and parse the file
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        // Try to parse as JSON
        const data = JSON.parse(content);

        let foundXpub = '';
        let foundFingerprint = '';
        let foundDerivation = '';
        let foundLabel = '';

        // ============================================================
        // COMPREHENSIVE HARDWARE WALLET JSON FORMAT SUPPORT
        // ============================================================
        // Supported formats:
        // 1. Output Descriptor format (Sparrow, ColdCard wallet export, Specter)
        // 2. ColdCard Generic JSON (Advanced > MicroSD > Export Wallet > Generic JSON)
        // 3. Keystone JSON format (with coins/accounts structure)
        // 4. Keystone Multisig format (with ExtendedPublicKey, Path, xfp)
        // 5. Ledger Live Advanced Logs format (xpub with freshAddressPath)
        // 6. BitBox02 BIP-329 format
        // 7. Jade/BlueWallet/Nunchuk multisig wallet file format
        // 8. Simple/direct format (various wallets)
        // ============================================================

        // FORMAT 1: Output Descriptor format
        // Example: { descriptor: "wpkh([fingerprint/84h/0h/0h]xpub.../0/*)#checksum", label: "..." }
        if (data.descriptor) {
          const descriptorMatch = data.descriptor.match(/\[([a-fA-F0-9]{8})\/([^\]]+)\]([xyztuv]pub[a-zA-Z0-9]+)/);
          if (descriptorMatch) {
            foundFingerprint = descriptorMatch[1];
            const pathPart = descriptorMatch[2].replace(/h/g, "'");
            foundDerivation = `m/${pathPart}`;
            foundXpub = descriptorMatch[3];
          }
          if (data.label) foundLabel = data.label;
        }

        // FORMAT 2: ColdCard Generic JSON format
        // Example: { xfp: "...", bip84: { xpub: "...", _pub: "zpub...", deriv: "m/84'/0'/0'" } }
        if (!foundXpub && (data.bip84 || data.bip49 || data.bip44 || data.bip86)) {
          // Prefer BIP84 (Native SegWit), then BIP86 (Taproot), then BIP49, then BIP44
          const bipSection = data.bip84 || data.bip86 || data.bip49 || data.bip44;
          if (bipSection) {
            foundXpub = bipSection._pub || bipSection.xpub || '';
            foundDerivation = bipSection.deriv || '';
          }
        }

        // FORMAT 3: Keystone JSON format (QR code decoded or file export)
        // Example: { coins: [{ coinCode: "BTC", accounts: [{ hdPath: "M/84'/0'/0'", xPub: "xpub..." }] }] }
        // Or nested: { data: { sync: { coins: [...] } } }
        const keystoneCoins = data.coins || data.data?.sync?.coins;
        if (!foundXpub && keystoneCoins && Array.isArray(keystoneCoins)) {
          const btcCoin = keystoneCoins.find((c: any) => c.coinCode === 'BTC' || c.coin === 'BTC');
          if (btcCoin?.accounts && Array.isArray(btcCoin.accounts)) {
            // Prefer Native SegWit (84') account
            const nativeSegwit = btcCoin.accounts.find((a: any) => a.hdPath?.includes("84'") || a.hdPath?.includes("84h"));
            const account = nativeSegwit || btcCoin.accounts[0];
            if (account) {
              foundXpub = account.xPub || account.xpub || '';
              foundDerivation = (account.hdPath || '').replace(/^M/, 'm');
            }
          }
        }

        // FORMAT 4: Keystone Multisig export format
        // Example: { ExtendedPublicKey: "Zpub...", Path: "M/48'/0'/0'/2'", xfp: "37b5eed4" }
        if (!foundXpub && data.ExtendedPublicKey) {
          foundXpub = data.ExtendedPublicKey;
          foundDerivation = (data.Path || '').replace(/^M/, 'm');
          foundFingerprint = data.xfp || '';
        }

        // FORMAT 5: Ledger Live Advanced Logs format
        // Example: { xpub: "xpub...", freshAddressPath: "44'/0'/0'/0/0" }
        // Note: Ledger always outputs xpub prefix, need to check freshAddressPath for actual type
        if (!foundXpub && data.xpub && data.freshAddressPath) {
          foundXpub = data.xpub;
          // Extract account path from freshAddressPath (remove last two components: /0/0)
          const pathMatch = data.freshAddressPath.match(/^(\d+)'\/(\d+)'\/(\d+)'/);
          if (pathMatch) {
            foundDerivation = `m/${pathMatch[1]}'/${pathMatch[2]}'/${pathMatch[3]}'`;
          }
          if (data.name) foundLabel = data.name;
        }

        // FORMAT 6: BitBox02 format (simple xpub/ypub/zpub with optional metadata)
        // Example: { keypath: "m/84'/0'/0'", xpub: "zpub..." }
        if (!foundXpub && data.keypath && data.xpub) {
          foundXpub = data.xpub;
          foundDerivation = data.keypath;
        }

        // FORMAT 7: Jade/BlueWallet/Nunchuk multisig wallet file format
        // Example: { fingerprint: "...", derivation: [...], xpub: "..." }
        // Or: { signers: [{ fingerprint: "...", xpub: "...", derivation: "..." }] }
        if (!foundXpub && data.signers && Array.isArray(data.signers)) {
          const signer = data.signers[0];
          if (signer) {
            foundXpub = signer.xpub || '';
            foundFingerprint = signer.fingerprint || signer.xfp || '';
            foundDerivation = Array.isArray(signer.derivation)
              ? `m/${signer.derivation.join('/')}`
              : (signer.derivation || '');
          }
        }

        // FORMAT 8: Simple/direct format fallbacks
        // Example: { xpub: "...", xfp: "...", derivation: "..." }
        if (!foundXpub && data.xpub) {
          foundXpub = data.xpub;
        }
        if (!foundXpub && data.zpub) {
          foundXpub = data.zpub;
        }
        if (!foundXpub && data.ypub) {
          foundXpub = data.ypub;
        }
        if (!foundXpub && data.p2wpkh) {
          foundXpub = data.p2wpkh;
        }

        // Extract fingerprint from various field names
        if (!foundFingerprint) {
          foundFingerprint = data.xfp || data.fingerprint || data.master_fingerprint ||
                            data.masterFingerprint || data.root_fingerprint || '';
        }

        // Extract derivation path from various field names
        if (!foundDerivation) {
          foundDerivation = data.deriv || data.derivation || data.path ||
                          data.derivationPath || data.hdPath || data.keypath || '';
          // Normalize: ensure starts with 'm/'
          if (foundDerivation && !foundDerivation.startsWith('m/')) {
            foundDerivation = foundDerivation.startsWith('M/')
              ? foundDerivation.replace(/^M/, 'm')
              : `m/${foundDerivation}`;
          }
        }

        // Extract label from various field names
        if (!foundLabel) {
          foundLabel = data.label || data.name || data.walletName || data.wallet_name || '';
        }

        // Validate we got what we need
        if (!foundXpub && !foundFingerprint) {
          setError('Could not find xpub or fingerprint in file. Please check the format.');
          setScanning(false);
          return;
        }

        // Set the extracted values
        if (foundXpub) setXpub(foundXpub);
        if (foundFingerprint) setFingerprint(foundFingerprint);
        if (foundDerivation) setDerivationPath(foundDerivation);
        if (foundLabel && !label) setLabel(foundLabel);

        setScanned(true);
        setScanning(false);
      } catch (err) {
        // If not JSON, try to extract xpub from plain text
        const content = event.target?.result as string;

        // Try to extract descriptor from plain text
        const descriptorMatch = content.match(/\[([a-fA-F0-9]{8})\/([^\]]+)\]([xyztuv]pub[a-zA-Z0-9]+)/);
        if (descriptorMatch) {
          setFingerprint(descriptorMatch[1]);
          const pathPart = descriptorMatch[2].replace(/h/g, "'");
          setDerivationPath(`m/${pathPart}`);
          setXpub(descriptorMatch[3]);
          setScanned(true);
          setScanning(false);
          return;
        }

        // Try to extract standalone xpub
        const xpubMatch = content.match(/([xyztuv]pub[a-zA-Z0-9]{100,})/i);
        if (xpubMatch) {
          setXpub(xpubMatch[1]);
          setScanned(true);
          setScanning(false);
          return;
        }

        // Try Zpub/Ypub (capital - multisig formats)
        const multisigPubMatch = content.match(/([ZY]pub[a-zA-Z0-9]{100,})/);
        if (multisigPubMatch) {
          setXpub(multisigPubMatch[1]);
          setScanned(true);
          setScanning(false);
          return;
        }

        setError('Could not parse file. Please check the format.');
        setScanning(false);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setScanning(false);
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    if (!selectedModel) return;

    setSaving(true);
    setError(null);

    try {
      const deviceData: CreateDeviceRequest = {
        type: selectedModel.name,
        label: label || `${selectedModel.name} ${fingerprint}`,
        fingerprint: fingerprint || '00000000',
        xpub,
        derivationPath,
        modelSlug: selectedModel.slug
      };
      await createDevice(deviceData);
      navigate('/devices');
    } catch (err: any) {
      console.error('Failed to save device:', err);
      setError(err?.message || 'Failed to save device. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Render device capability badges
  const renderCapabilities = (model: HardwareDeviceModel) => {
    const badges = [];

    if (model.airGapped) {
      badges.push(
        <span key="airgap" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          <Wifi className="w-3 h-3 mr-1 line-through" /> Air-Gapped
        </span>
      );
    }
    if (model.secureElement) {
      badges.push(
        <span key="secure" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          <Shield className="w-3 h-3 mr-1" /> Secure Element
        </span>
      );
    }
    if (model.openSource) {
      badges.push(
        <span key="opensource" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
          <Code className="w-3 h-3 mr-1" /> Open Source
        </span>
      );
    }
    if (model.supportsBitcoinOnly) {
      badges.push(
        <span key="btconly" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          Bitcoin Only
        </span>
      );
    }

    return badges;
  };

  // Filter models by manufacturer and search query
  // Note: useMemo MUST be called before any conditional returns (React hooks rules)
  const filteredModels = useMemo(() => {
    let models = deviceModels;

    // Filter by manufacturer
    if (selectedManufacturer) {
      models = models.filter(m => m.manufacturer === selectedManufacturer);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      models = models.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.manufacturer.toLowerCase().includes(query)
      );
    }

    return models;
  }, [deviceModels, selectedManufacturer, searchQuery]);

  const availableMethods = getAvailableMethods();

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
      <button
        onClick={() => navigate('/devices')}
        className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Devices
      </button>

      <div>
        <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">Connect Hardware Device</h1>
        <p className="text-sanctuary-500">Add a new signing device to your sanctuary.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Step 1: Select Device Model */}
        <div className="lg:col-span-2 space-y-4">
          <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-sanctuary-500 uppercase">1. Select Your Device</h3>
              <span className="text-xs text-sanctuary-400">{filteredModels.length} devices</span>
            </div>

            {/* Search Bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search devices..."
                className="w-full pl-10 pr-10 py-2.5 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500 placeholder-sanctuary-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-full transition-colors"
                >
                  <X className="w-3 h-3 text-sanctuary-400" />
                </button>
              )}
            </div>

            {/* Manufacturer Filter */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setSelectedManufacturer(null)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  !selectedManufacturer
                    ? 'bg-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
                    : 'surface-secondary text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                }`}
              >
                All
              </button>
              {manufacturers.map(mfr => (
                <button
                  key={mfr}
                  onClick={() => setSelectedManufacturer(mfr)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    selectedManufacturer === mfr
                      ? 'bg-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
                      : 'surface-secondary text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                  }`}
                >
                  {mfr}
                </button>
              ))}
            </div>

            {/* Device Grid - Increased height */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-2 -mr-2">
              {filteredModels.length === 0 ? (
                <div className="col-span-full text-center py-8 text-sanctuary-400">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No devices match your search</p>
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedManufacturer(null); }}
                    className="text-sm text-sanctuary-600 dark:text-sanctuary-300 hover:underline mt-2"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                filteredModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model)}
                    className={`p-3 rounded-xl border text-left text-sm transition-all flex flex-col items-center justify-center space-y-2 py-4 ${
                      selectedModel?.id === model.id
                        ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500'
                        : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400 dark:hover:border-sanctuary-500'
                    }`}
                  >
                    {getDeviceIcon(model.name, "w-8 h-8 opacity-80")}
                    <div className="font-medium text-center text-sanctuary-900 dark:text-sanctuary-100 text-xs">{model.name}</div>
                    <div className="text-[10px] text-sanctuary-500">{model.manufacturer}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Step 2: Connection Method (only show if device selected) */}
          {selectedModel && (
            <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
              <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">2. Connection Method</h3>

              {/* Device Capabilities Preview */}
              <div className="mb-4 p-3 surface-muted rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    {getDeviceIcon(selectedModel.name, "w-6 h-6")}
                    <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{selectedModel.name}</span>
                  </div>
                  <div className="flex space-x-1">
                    {selectedModel.connectivity.map(conn => {
                      const config = connectivityConfig[conn];
                      if (!config) return null;
                      const Icon = config.icon;
                      return (
                        <span key={conn} className="p-1.5 bg-sanctuary-200 dark:bg-sanctuary-800 rounded" title={config.label}>
                          <Icon className="w-3.5 h-3.5 text-sanctuary-600 dark:text-sanctuary-400" />
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {renderCapabilities(selectedModel)}
                </div>
              </div>

              {/* Connection Method Selection */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availableMethods.map((m) => {
                  const config = m === 'manual'
                    ? { icon: PenTool, label: 'Manual Entry', description: 'Enter xpub manually' }
                    : connectivityConfig[m];
                  if (!config) return null;
                  const Icon = config.icon;

                  return (
                    <button
                      key={m}
                      onClick={() => { setMethod(m); setScanned(false); setError(null); }}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        method === m
                          ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500'
                          : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
                      }`}
                    >
                      <Icon className="w-5 h-5 mb-2 text-sanctuary-600 dark:text-sanctuary-400" />
                      <div className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100">{config.label}</div>
                      <div className="text-xs text-sanctuary-500">{config.description}</div>
                    </button>
                  );
                })}
              </div>

              {/* Connection Action Area */}
              {method && (
                <div className="mt-4">
                  {(method === 'usb' || method === 'bluetooth' || method === 'nfc') && (
                    <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                      {!scanning && !scanned && (
                        <>
                          <div className="mx-auto text-sanctuary-400 mb-3 flex justify-center">
                            {getDeviceIcon(selectedModel.name, "w-12 h-12")}
                          </div>
                          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
                            {method === 'usb' && `Connect your ${selectedModel.name} via USB and unlock it.`}
                            {method === 'bluetooth' && `Enable Bluetooth on your ${selectedModel.name} and pair it.`}
                            {method === 'nfc' && `Hold your ${selectedModel.name} near this device.`}
                          </p>
                          <Button onClick={handleScan}>
                            {method === 'usb' && 'Scan for Device'}
                            {method === 'bluetooth' && 'Pair Device'}
                            {method === 'nfc' && 'Tap to Connect'}
                          </Button>
                        </>
                      )}
                      {scanning && (
                        <div className="flex flex-col items-center">
                          <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
                          <p className="text-sm text-sanctuary-500">Searching for device...</p>
                        </div>
                      )}
                      {scanned && (
                        <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
                          <Check className="w-10 h-10 mb-2" />
                          <p className="font-medium">Device Detected</p>
                        </div>
                      )}
                    </div>
                  )}

                  {(method === 'sd_card' || method === 'qr_code') && (
                    <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                      {!scanning && !scanned && (
                        <>
                          <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
                          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
                            {method === 'sd_card' && `Upload the export file from your ${selectedModel.name} SD card.`}
                            {method === 'qr_code' && `Upload a QR code export from your ${selectedModel.name}.`}
                          </p>
                          <label className="cursor-pointer">
                            <span className="inline-flex items-center justify-center rounded-lg px-4 py-2 bg-sanctuary-800 text-sanctuary-50 text-sm font-medium hover:bg-sanctuary-700 transition-colors">
                              Select File
                            </span>
                            <input
                              type="file"
                              className="hidden"
                              accept=".json,.txt,.png,.jpg"
                              onChange={handleFileUpload}
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
                      {scanned && (
                        <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
                          <Check className="w-10 h-10 mb-2" />
                          <p className="font-medium">File Imported Successfully</p>
                        </div>
                      )}
                    </div>
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
          )}
        </div>

        {/* Step 3: Device Details & Save (Right Column) */}
        <div className="space-y-4">
          <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 sticky top-4">
            <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">3. Device Details</h3>

            {!selectedModel ? (
              <div className="text-center py-8 text-sanctuary-400">
                <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Select a device to continue</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-sanctuary-500 mb-1">Device Label</label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`My ${selectedModel.name}`}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-sanctuary-500 mb-1">Derivation Path</label>
                  <input
                    type="text"
                    value={derivationPath}
                    onChange={(e) => setDerivationPath(e.target.value)}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                  />
                  <p className="text-[10px] text-sanctuary-400 mt-1">BIP84 Native SegWit default</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-sanctuary-500 mb-1">Master Fingerprint</label>
                  <input
                    type="text"
                    value={fingerprint}
                    onChange={(e) => setFingerprint(e.target.value)}
                    placeholder="00000000"
                    readOnly={method !== 'manual' && scanned}
                    className={`w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500 ${method !== 'manual' && scanned ? 'opacity-70' : ''}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-sanctuary-500 mb-1">Extended Public Key</label>
                  <textarea
                    value={xpub}
                    onChange={(e) => setXpub(e.target.value)}
                    placeholder="xpub... / ypub... / zpub..."
                    readOnly={method !== 'manual' && scanned}
                    rows={3}
                    className={`w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500 resize-none ${method !== 'manual' && scanned ? 'opacity-70' : ''}`}
                  />
                </div>

                <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
                  <Button
                    onClick={handleSave}
                    className="w-full"
                    disabled={!fingerprint || !xpub || saving || !method}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        Save Device
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>

                  {error && (
                    <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-2">
                      {error}
                    </p>
                  )}

                  {(!fingerprint || !xpub) && !error && method && (
                    <p className="text-center text-xs text-sanctuary-400 mt-2">
                      {method === 'manual'
                        ? 'Enter fingerprint and xpub to save.'
                        : 'Complete the connection step to enable saving.'
                      }
                    </p>
                  )}

                  {!method && (
                    <p className="text-center text-xs text-sanctuary-400 mt-2">
                      Select a connection method to continue.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
