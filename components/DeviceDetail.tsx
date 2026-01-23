import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Scanner } from '@yudiel/react-qr-scanner';
import { URRegistryDecoder, CryptoOutput, CryptoHDKey, CryptoAccount } from '@keystonehq/bc-ur-registry';
import { URDecoder as BytesURDecoder } from '@ngraveio/bc-ur';
import { WalletType, HardwareDevice, HardwareDeviceModel, DeviceRole, Device, DeviceShareInfo, DeviceAccount, isMultisigType } from '../types';
import { getDevice, updateDevice, getDeviceModels, getDeviceShareInfo, shareDeviceWithUser, removeUserFromDevice, shareDeviceWithGroup, addDeviceAccount, DeviceAccountInput } from '../src/api/devices';
import { parseDeviceJson, DeviceAccount as ParsedDeviceAccount } from '../services/deviceParsers';
import { hardwareWalletService, isSecureContext, DeviceType } from '../services/hardwareWallet';
import * as authApi from '../src/api/auth';
import * as adminApi from '../src/api/admin';
import { getDeviceIcon, getWalletIcon } from './ui/CustomIcons';
import { Edit2, Save, X, ArrowLeft, ChevronDown, Users, Shield, Send, User as UserIcon, Plus, Loader2, Usb, QrCode, HardDrive, Camera, Upload, AlertCircle, Check, AlertTriangle } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';
import { TransferOwnershipModal } from './TransferOwnershipModal';
import { PendingTransfersPanel } from './PendingTransfersPanel';
import { ManualAccountForm, AccountList, getAccountTypeInfo } from './DeviceDetail';
import type { ManualAccountData } from './DeviceDetail';

const log = createLogger('DeviceDetail');

type TabType = 'details' | 'access';

// Wallet info for display
interface WalletInfo {
  id: string;
  name: string;
  type: WalletType | string;
}

// Group display type
interface GroupDisplay {
  id: string;
  name: string;
}

export const DeviceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useUser();

  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editModelSlug, setEditModelSlug] = useState<string>('');
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [accessSubTab, setAccessSubTab] = useState<'ownership' | 'sharing' | 'transfers'>('ownership');
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Sharing state
  const [deviceShareInfo, setDeviceShareInfo] = useState<DeviceShareInfo | null>(null);
  const [groups, setGroups] = useState<GroupDisplay[]>([]);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);

  // Add account state
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [addAccountLoading, setAddAccountLoading] = useState(false);
  const [addAccountError, setAddAccountError] = useState<string | null>(null);
  const [addAccountMethod, setAddAccountMethod] = useState<'usb' | 'manual' | 'sdcard' | 'qr' | null>(null);
  const [usbProgress, setUsbProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [manualAccount, setManualAccount] = useState<{
    purpose: 'single_sig' | 'multisig';
    scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
    derivationPath: string;
    xpub: string;
  }>({
    purpose: 'multisig',
    scriptType: 'native_segwit',
    derivationPath: "m/48'/0'/0'/2'",
    xpub: '',
  });

  // QR scanning state
  const [qrMode, setQrMode] = useState<'camera' | 'file'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [urProgress, setUrProgress] = useState<number>(0);
  const urDecoderRef = useRef<URRegistryDecoder | null>(null);
  const bytesDecoderRef = useRef<BytesURDecoder | null>(null);

  // Parsed accounts from file/QR import
  const [parsedAccounts, setParsedAccounts] = useState<ParsedDeviceAccount[]>([]);
  const [selectedParsedAccounts, setSelectedParsedAccounts] = useState<Set<number>>(new Set());
  const [importFingerprint, setImportFingerprint] = useState<string>('');

  // Conflict state for adding accounts
  interface AccountConflict {
    existingAccounts: DeviceAccount[];
    newAccounts: ParsedDeviceAccount[];
    matchingAccounts: ParsedDeviceAccount[];
  }
  const [accountConflict, setAccountConflict] = useState<AccountConflict | null>(null);

  // Derived ownership state
  const isOwner = device?.isOwner ?? true; // Default to true for backward compat
  const userRole = device?.userRole ?? 'owner';

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !user) return;
      try {
        // Fetch device and available models in parallel
        const [deviceData, models] = await Promise.all([
          getDevice(id),
          getDeviceModels()
        ]);

        setDevice(deviceData);
        setDeviceModels(models);

        // Warn if ownership fields are missing (indicates API issue)
        if (deviceData.isOwner === undefined || deviceData.userRole === undefined) {
          log.warn('Device ownership fields missing from API response', {
            deviceId: id,
            hasIsOwner: deviceData.isOwner !== undefined,
            hasUserRole: deviceData.userRole !== undefined,
          });
        }

        // Extract wallet info from device data
        const walletList = deviceData.wallets?.map(w => ({
          id: w.wallet.id,
          name: w.wallet.name,
          type: w.wallet.type === 'multi_sig' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG
        })) || [];
        setWallets(walletList);
        setEditLabel(deviceData.label);
        setEditModelSlug(deviceData.model?.slug || '');
      } catch (error) {
        log.error('Failed to fetch device', { error });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, user]);

  const handleSave = async () => {
    if (!device) return;
    try {
      const updateData: { label?: string; modelSlug?: string } = {};
      if (editLabel !== device.label) updateData.label = editLabel;
      if (editModelSlug !== (device.model?.slug || '')) updateData.modelSlug = editModelSlug;

      const updatedDevice = await updateDevice(device.id, updateData);
      setDevice({ ...device, ...updatedDevice, label: editLabel });
      setIsEditing(false);
    } catch (error) {
      log.error('Failed to update device', { error });
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditLabel(device?.label || '');
    setEditModelSlug(device?.model?.slug || '');
  };

  // Fetch share info
  const fetchShareInfo = useCallback(async () => {
    if (!id) return;
    try {
      const info = await getDeviceShareInfo(id);
      setDeviceShareInfo(info);
    } catch (err) {
      log.error('Failed to fetch share info', { err });
    }
  }, [id]);

  // Fetch groups
  const fetchGroups = useCallback(async () => {
    try {
      const userGroups = user?.isAdmin
        ? await adminApi.getGroups()
        : await authApi.getUserGroups();
      setGroups(userGroups);
    } catch (err) {
      log.error('Failed to fetch groups', { err });
    }
  }, [user?.isAdmin]);

  // Fetch sharing data when device is loaded
  useEffect(() => {
    if (device && id) {
      fetchShareInfo();
      fetchGroups();
    }
  }, [device, id, fetchShareInfo, fetchGroups]);

  // User search handler
  const handleSearchUsers = useCallback(async (query: string) => {
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }

    setSearchingUsers(true);
    try {
      const results = await authApi.searchUsers(query);
      const existingUserIds = new Set(deviceShareInfo?.users.map(u => u.id) || []);
      setUserSearchResults(results.filter(u => !existingUserIds.has(u.id)));
    } catch (err) {
      log.error('Failed to search users', { err });
    } finally {
      setSearchingUsers(false);
    }
  }, [deviceShareInfo]);

  // Share with user
  const handleShareWithUser = async (targetUserId: string) => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithUser(id, { targetUserId });
      await fetchShareInfo();
      setUserSearchQuery('');
      setUserSearchResults([]);
    } catch (err) {
      log.error('Failed to share with user', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Remove user access
  const handleRemoveUserAccess = async (targetUserId: string) => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await removeUserFromDevice(id, targetUserId);
      await fetchShareInfo();
    } catch (err) {
      log.error('Failed to remove user access', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Add group
  const addGroup = async () => {
    if (!id || !selectedGroupToAdd) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithGroup(id, { groupId: selectedGroupToAdd });
      await fetchShareInfo();
      setSelectedGroupToAdd('');
    } catch (err) {
      log.error('Failed to share with group', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Remove group
  const removeGroup = async () => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithGroup(id, { groupId: null });
      await fetchShareInfo();
    } catch (err) {
      log.error('Failed to remove group access', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Reload device data after transfer actions
  const handleTransferComplete = async () => {
    if (!id || !user) return;
    try {
      const deviceData = await getDevice(id);
      setDevice(deviceData);
    } catch (error) {
      log.error('Failed to reload device after transfer', { error });
    }
  };

  // Helper to get device type from device model
  const getDeviceTypeFromDeviceModel = (): DeviceType | null => {
    if (!device) return null;
    const type = device.type?.toLowerCase();
    if (type?.includes('trezor')) return 'trezor';
    if (type?.includes('ledger')) return 'ledger';
    if (type?.includes('coldcard')) return 'coldcard';
    if (type?.includes('bitbox')) return 'bitbox';
    if (type?.includes('jade')) return 'jade';
    return null;
  };

  // Add accounts via USB connection
  const handleAddAccountsViaUsb = async () => {
    if (!id || !device) return;

    const deviceType = getDeviceTypeFromDeviceModel();
    if (!deviceType) {
      setAddAccountError('USB connection not supported for this device type');
      return;
    }

    setAddAccountLoading(true);
    setAddAccountError(null);
    setUsbProgress(null);

    try {
      // Connect to the device
      await hardwareWalletService.connect(deviceType);

      // Fetch all xpubs
      const allXpubs = await hardwareWalletService.getAllXpubs((current, total, name) => {
        setUsbProgress({ current, total, name });
      });

      // Filter out accounts that already exist on this device
      const existingPaths = new Set(device.accounts?.map(a => a.derivationPath) || []);
      const newAccounts = allXpubs.filter(x => !existingPaths.has(x.path));

      if (newAccounts.length === 0) {
        setAddAccountError('No new accounts to add. All derivation paths already exist on this device.');
        return;
      }

      // Add each new account
      let addedCount = 0;
      for (const account of newAccounts) {
        try {
          await addDeviceAccount(id, {
            purpose: account.purpose,
            scriptType: account.scriptType,
            derivationPath: account.path,
            xpub: account.xpub,
          });
          addedCount++;
        } catch (err) {
          log.warn('Failed to add account', { path: account.path, err });
        }
      }

      // Refresh device data
      const updatedDevice = await getDevice(id);
      setDevice(updatedDevice);
      setShowAddAccount(false);
      setAddAccountMethod(null);

      log.info('Added accounts via USB', { addedCount, totalFetched: allXpubs.length });
    } catch (err) {
      log.error('Failed to add accounts via USB', { err });
      setAddAccountError(err instanceof Error ? err.message : 'Failed to connect to device');
    } finally {
      setAddAccountLoading(false);
      setUsbProgress(null);
      try {
        await hardwareWalletService.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
  };

  // Add account manually
  const handleAddAccountManually = async () => {
    if (!id || !manualAccount.xpub || !manualAccount.derivationPath) return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    try {
      await addDeviceAccount(id, manualAccount);

      // Refresh device data
      const updatedDevice = await getDevice(id);
      setDevice(updatedDevice);
      setShowAddAccount(false);
      setAddAccountMethod(null);
      setManualAccount({
        purpose: 'multisig',
        scriptType: 'native_segwit',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: '',
      });

      log.info('Added account manually', { path: manualAccount.derivationPath });
    } catch (err) {
      log.error('Failed to add account manually', { err });
      setAddAccountError(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setAddAccountLoading(false);
    }
  };

  /**
   * Normalize a derivation path to standard format
   */
  const normalizeDerivationPath = (path: string): string => {
    if (!path) return '';
    let normalized = path.trim();
    if (normalized.startsWith('M/')) {
      normalized = 'm/' + normalized.slice(2);
    } else if (!normalized.startsWith('m/')) {
      normalized = 'm/' + normalized;
    }
    normalized = normalized.replace(/(\d+)h/g, "$1'");
    return normalized;
  };

  /**
   * Extract fingerprint from CryptoHDKey
   */
  const extractFingerprintFromHdKey = (hdKey: CryptoHDKey): string => {
    const origin = hdKey.getOrigin();
    if (origin) {
      const sourceFingerprint = origin.getSourceFingerprint();
      if (sourceFingerprint && sourceFingerprint.length > 0) {
        return sourceFingerprint.toString('hex');
      }
    }
    try {
      const parentFp = hdKey.getParentFingerprint();
      if (parentFp && parentFp.length > 0) {
        return parentFp.toString('hex');
      }
    } catch {
      // getParentFingerprint might not exist or fail
    }
    return '';
  };

  /**
   * Extract xpub data from UR registry result
   */
  const extractFromUrResult = (registryType: unknown): { xpub: string; fingerprint: string; path: string } | null => {
    try {
      if (registryType instanceof CryptoHDKey) {
        const hdKey = registryType as CryptoHDKey;
        const xpub = hdKey.getBip32Key();
        const fingerprint = extractFingerprintFromHdKey(hdKey);
        const origin = hdKey.getOrigin();
        const pathComponents = origin?.getComponents() || [];
        const path = pathComponents.length > 0
          ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
          : '';
        return { xpub, fingerprint, path };
      }

      if (registryType instanceof CryptoOutput) {
        const output = registryType as CryptoOutput;
        const hdKey = output.getHDKey();
        if (hdKey) {
          const xpub = hdKey.getBip32Key();
          const fingerprint = extractFingerprintFromHdKey(hdKey);
          const origin = hdKey.getOrigin();
          const pathComponents = origin?.getComponents() || [];
          const path = pathComponents.length > 0
            ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
            : '';
          return { xpub, fingerprint, path };
        }
      }

      if (registryType instanceof CryptoAccount) {
        const account = registryType as CryptoAccount;
        const masterFingerprint = account.getMasterFingerprint()?.toString('hex') || '';
        const outputs = account.getOutputDescriptors();
        for (const output of outputs) {
          const hdKey = output.getHDKey();
          if (hdKey) {
            const xpub = hdKey.getBip32Key();
            const origin = hdKey.getOrigin();
            const pathComponents = origin?.getComponents() || [];
            const path = pathComponents.length > 0
              ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
              : '';
            if (path.includes("84'")) {
              return { xpub, fingerprint: masterFingerprint, path };
            }
          }
        }
        if (outputs.length > 0) {
          const hdKey = outputs[0].getHDKey();
          if (hdKey) {
            const xpub = hdKey.getBip32Key();
            const origin = hdKey.getOrigin();
            const pathComponents = origin?.getComponents() || [];
            const path = pathComponents.length > 0
              ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
              : '';
            return { xpub, fingerprint: masterFingerprint, path };
          }
        }
      }

      // Handle ur:bytes format
      const regType = registryType as { bytes?: Uint8Array };
      if (regType && regType.bytes instanceof Uint8Array) {
        const textDecoder = new TextDecoder('utf-8');
        const textContent = textDecoder.decode(regType.bytes);
        const result = parseDeviceJson(textContent);
        if (result && result.xpub) {
          return {
            xpub: result.xpub,
            fingerprint: result.fingerprint || '',
            path: result.derivationPath || ''
          };
        }
      }

      return null;
    } catch (err) {
      log.error('Failed to extract from UR result', { err });
      return null;
    }
  };

  /**
   * Process parsed accounts - compare with existing device accounts
   */
  const processImportedAccounts = (accounts: ParsedDeviceAccount[], fingerprint: string) => {
    if (!device) return;

    // SECURITY: Fingerprint validation prevents adding accounts from wrong device.
    // Case-insensitive comparison because different hardware wallets export fingerprints
    // in different formats (some uppercase, some lowercase). This is a security check
    // to ensure imported data belongs to this device.
    if (fingerprint && device.fingerprint.toLowerCase() !== fingerprint.toLowerCase()) {
      setAddAccountError(`Fingerprint mismatch: imported ${fingerprint} but device has ${device.fingerprint}`);
      return;
    }

    const existingPaths = new Set(device.accounts?.map(a => a.derivationPath) || []);
    const existingXpubs = new Map(device.accounts?.map(a => [a.derivationPath, a.xpub]) || []);

    const newAccounts: ParsedDeviceAccount[] = [];
    const matchingAccounts: ParsedDeviceAccount[] = [];
    const conflictingAccounts: ParsedDeviceAccount[] = [];

    for (const account of accounts) {
      if (!existingPaths.has(account.derivationPath)) {
        newAccounts.push(account);
      } else {
        const existingXpub = existingXpubs.get(account.derivationPath);
        if (existingXpub === account.xpub) {
          matchingAccounts.push(account);
        } else {
          conflictingAccounts.push(account);
        }
      }
    }

    if (conflictingAccounts.length > 0) {
      setAddAccountError(`${conflictingAccounts.length} account(s) have conflicting xpubs - this may indicate a security issue`);
      return;
    }

    if (newAccounts.length === 0) {
      setAddAccountError('No new accounts to add - all derivation paths already exist on this device');
      return;
    }

    // Set up for selection
    setParsedAccounts(newAccounts);
    setSelectedParsedAccounts(new Set(newAccounts.map((_, i) => i)));
    setImportFingerprint(fingerprint);
    setAccountConflict({
      existingAccounts: device.accounts || [],
      newAccounts,
      matchingAccounts,
    });
  };

  /**
   * Handle file upload for SD card import
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = parseDeviceJson(content);

      if (result && (result.xpub || result.accounts?.length)) {
        if (result.accounts && result.accounts.length > 0) {
          processImportedAccounts(result.accounts, result.fingerprint || '');
          log.info('File parsed with multiple accounts', {
            format: result.format,
            accountCount: result.accounts.length,
          });
        } else if (result.xpub) {
          // Single account - convert to account format
          // BIP-48 defines script type indices in the derivation path: m/48'/coin'/account'/script'
          // Script type index: /1' = nested_segwit (P2SH-P2WSH), /2' = native_segwit (P2WSH)
          const singleAccount: ParsedDeviceAccount = {
            purpose: result.derivationPath?.includes("48'") ? 'multisig' : 'single_sig',
            scriptType: result.derivationPath?.includes("/2'") ? 'native_segwit' :
                       result.derivationPath?.includes("/1'") ? 'nested_segwit' : 'native_segwit',
            derivationPath: result.derivationPath || "m/84'/0'/0'",
            xpub: result.xpub,
          };
          processImportedAccounts([singleAccount], result.fingerprint || '');
        }
        setAddAccountLoading(false);
      } else {
        setAddAccountError('Could not parse file. Please check the format.');
        setAddAccountLoading(false);
      }
    };
    reader.onerror = () => {
      setAddAccountError('Failed to read file.');
      setAddAccountLoading(false);
    };
    reader.readAsText(file);
  };

  /**
   * Handle QR code scan result
   */
  const handleQrScan = (result: { rawValue: string }[]) => {
    if (!result || result.length === 0) return;

    const content = result[0].rawValue;
    const contentLower = content.toLowerCase();

    log.info('QR code scanned', { length: content.length, prefix: content.substring(0, 50) });

    // Check if this is UR format
    if (contentLower.startsWith('ur:')) {
      const urTypeMatch = contentLower.match(/^ur:([a-z0-9-]+)/);
      const urType = urTypeMatch ? urTypeMatch[1] : 'unknown';

      try {
        // Handle ur:bytes format
        if (urType === 'bytes') {
          if (!bytesDecoderRef.current) {
            bytesDecoderRef.current = new BytesURDecoder();
          }

          bytesDecoderRef.current.receivePart(content);
          const progress = bytesDecoderRef.current.estimatedPercentComplete();
          setUrProgress(Math.round(progress * 100));

          if (bytesDecoderRef.current.isComplete() !== true) {
            return;
          }

          setCameraActive(false);
          setAddAccountLoading(true);

          if (!bytesDecoderRef.current.isSuccess()) {
            throw new Error('UR bytes decode failed');
          }

          const decodedUR = bytesDecoderRef.current.resultUR();
          const rawBytes = decodedUR.decodeCBOR();
          const textDecoder = new TextDecoder('utf-8');
          const textContent = textDecoder.decode(rawBytes);

          const parseResult = parseDeviceJson(textContent);
          if (parseResult && parseResult.accounts) {
            processImportedAccounts(parseResult.accounts, parseResult.fingerprint || '');
          } else if (parseResult && parseResult.xpub) {
            const singleAccount: ParsedDeviceAccount = {
              purpose: parseResult.derivationPath?.includes("48'") ? 'multisig' : 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: parseResult.derivationPath || "m/84'/0'/0'",
              xpub: parseResult.xpub,
            };
            processImportedAccounts([singleAccount], parseResult.fingerprint || '');
          } else {
            throw new Error('Could not extract accounts from ur:bytes');
          }

          setAddAccountLoading(false);
          setUrProgress(0);
          bytesDecoderRef.current = null;
          return;
        }

        // For other UR types
        if (!urDecoderRef.current) {
          urDecoderRef.current = new URRegistryDecoder();
        }

        urDecoderRef.current.receivePart(content);
        const progress = urDecoderRef.current.estimatedPercentComplete();
        setUrProgress(Math.round(progress * 100));

        if (!urDecoderRef.current.isComplete()) {
          return;
        }

        setCameraActive(false);
        setAddAccountLoading(true);

        if (!urDecoderRef.current.isSuccess()) {
          throw new Error('UR decode failed');
        }

        const registryType = urDecoderRef.current.resultRegistryType();
        const extracted = extractFromUrResult(registryType);

        if (extracted && extracted.xpub) {
          const singleAccount: ParsedDeviceAccount = {
            purpose: extracted.path.includes("48'") ? 'multisig' : 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: normalizeDerivationPath(extracted.path) || "m/84'/0'/0'",
            xpub: extracted.xpub,
          };
          processImportedAccounts([singleAccount], extracted.fingerprint || '');
        } else {
          throw new Error('Could not extract xpub from UR');
        }

        setAddAccountLoading(false);
        setUrProgress(0);
        urDecoderRef.current = null;
        return;

      } catch (err) {
        log.error('Failed to decode UR QR code', { err });
        setAddAccountError(err instanceof Error ? err.message : 'Failed to decode UR QR code');
        setCameraActive(false);
        setAddAccountLoading(false);
        setUrProgress(0);
        urDecoderRef.current = null;
        bytesDecoderRef.current = null;
        return;
      }
    }

    // Non-UR format
    setCameraActive(false);
    setAddAccountLoading(true);

    const parseResult = parseDeviceJson(content);
    if (parseResult && (parseResult.xpub || parseResult.accounts?.length)) {
      if (parseResult.accounts && parseResult.accounts.length > 0) {
        processImportedAccounts(parseResult.accounts, parseResult.fingerprint || '');
      } else if (parseResult.xpub) {
        const singleAccount: ParsedDeviceAccount = {
          purpose: parseResult.derivationPath?.includes("48'") ? 'multisig' : 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: parseResult.derivationPath || "m/84'/0'/0'",
          xpub: parseResult.xpub,
        };
        processImportedAccounts([singleAccount], parseResult.fingerprint || '');
      }
      log.info('QR code parsed successfully', { format: parseResult.format });
    } else {
      setAddAccountError('Could not find valid account data in QR code');
    }
    setAddAccountLoading(false);
  };

  const handleCameraError = (error: unknown) => {
    log.error('Camera error', { error });
    setCameraActive(false);
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Please allow camera permissions.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError(`Camera error: ${error.message}`);
      }
    } else {
      setCameraError('Failed to access camera. Make sure you are using HTTPS.');
    }
  };

  /**
   * Add selected parsed accounts to the device
   */
  const handleAddParsedAccounts = async () => {
    if (!id || parsedAccounts.length === 0 || selectedParsedAccounts.size === 0) return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    try {
      let addedCount = 0;
      for (const [index, account] of parsedAccounts.entries()) {
        if (selectedParsedAccounts.has(index)) {
          try {
            await addDeviceAccount(id, {
              purpose: account.purpose,
              scriptType: account.scriptType,
              derivationPath: account.derivationPath,
              xpub: account.xpub,
            });
            addedCount++;
          } catch (err) {
            log.warn('Failed to add account', { path: account.derivationPath, err });
          }
        }
      }

      // Refresh device data
      const updatedDevice = await getDevice(id);
      setDevice(updatedDevice);
      setShowAddAccount(false);
      setAddAccountMethod(null);
      setParsedAccounts([]);
      setSelectedParsedAccounts(new Set());
      setAccountConflict(null);

      log.info('Added accounts from import', { addedCount });
    } catch (err) {
      log.error('Failed to add accounts', { err });
      setAddAccountError(err instanceof Error ? err.message : 'Failed to add accounts');
    } finally {
      setAddAccountLoading(false);
    }
  };

  /**
   * Reset import state
   */
  const resetImportState = () => {
    setParsedAccounts([]);
    setSelectedParsedAccounts(new Set());
    setAccountConflict(null);
    setImportFingerprint('');
    setCameraActive(false);
    setCameraError(null);
    setUrProgress(0);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
  };

  // Get display name for current device type
  const getDeviceDisplayName = (type: string): string => {
    const model = deviceModels.find(m => m.slug === type);
    return model ? model.name : type || 'Unknown Device';
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
                                        <button onClick={handleSave} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors" aria-label="Save label"><Save className="w-5 h-5" /></button>
                                        <button onClick={cancelEdit} className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors" aria-label="Cancel editing"><X className="w-5 h-5" /></button>
                                    </div>
                                ) : (
                                    <>
                                        <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">{device.label}</h1>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                          userRole === 'owner' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' :
                                          'bg-sanctuary-100 text-sanctuary-700 dark:bg-sanctuary-700 dark:text-sanctuary-300'
                                        }`}>
                                          {userRole === 'owner' ? 'Owner' : 'Viewer'}
                                        </span>
                                        {isOwner && (
                                          <button onClick={() => setIsEditing(true)} className="text-sanctuary-400 hover:text-sanctuary-600 p-1" aria-label="Edit label"><Edit2 className="w-4 h-4" /></button>
                                        )}
                                    </>
                                )}
                            </div>
                            {/* Shared by indicator */}
                            {!isOwner && device.sharedBy && (
                              <span className="text-xs text-sanctuary-400 flex items-center gap-1 mt-1">
                                <Users className="w-3 h-3" />
                                Shared by {device.sharedBy}
                              </span>
                            )}
                            {isEditing ? (
                                <div className="mt-2">
                                    <label className="text-xs text-sanctuary-500 uppercase mb-1 block">Device Type</label>
                                    <div className="relative">
                                        <select
                                            value={editModelSlug}
                                            onChange={e => setEditModelSlug(e.target.value)}
                                            className="w-full px-3 py-2 pr-8 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                        >
                                            <option value="">Unknown Device</option>
                                            {deviceModels.map(model => (
                                                <option key={model.slug} value={model.slug}>
                                                    {model.manufacturer} {model.name}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400 pointer-events-none" />
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sanctuary-500 mt-1 text-sm">{getDeviceDisplayName(device.type)}</p>
                            )}
                         </div>
                         <div className="text-right">
                             <div className="text-xs text-sanctuary-400 uppercase tracking-wide">Master Fingerprint</div>
                             <div className="text-xl font-mono text-sanctuary-700 dark:text-sanctuary-300">{device.fingerprint}</div>
                         </div>
                    </div>

                    {/* Device Accounts Section */}
                    <div className="mt-6 pt-6 border-t border-sanctuary-100 dark:border-sanctuary-800">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-sanctuary-500 uppercase">Registered Accounts</p>
                        <span className="text-xs text-sanctuary-400">
                          {device.accounts?.length || 1} {(device.accounts?.length || 1) === 1 ? 'account' : 'accounts'}
                        </span>
                      </div>

                      {device.accounts && device.accounts.length > 0 ? (
                        <div className="space-y-3">
                          {device.accounts.map((account) => {
                            const info = getAccountTypeInfo(account);
                            const isMultisig = account.purpose === 'multisig';

                            return (
                              <div
                                key={account.id}
                                className="surface-muted p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800"
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100 text-sm">
                                      {info.title}
                                    </span>
                                    {info.recommended && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                                        Recommended
                                      </span>
                                    )}
                                  </div>
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                                    isMultisig
                                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                  }`}>
                                    {isMultisig ? 'Multisig' : 'Single-sig'}
                                  </span>
                                </div>

                                <p className="text-xs text-sanctuary-500 mb-3">
                                  {info.description} <span className="text-sanctuary-400">Addresses: {info.addressPrefix}</span>
                                </p>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div>
                                    <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Derivation Path</p>
                                    <code className="text-xs text-sanctuary-600 dark:text-sanctuary-300 font-mono">
                                      {account.derivationPath}
                                    </code>
                                  </div>
                                  <div className="md:col-span-2">
                                    <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Extended Public Key</p>
                                    <code className="text-[10px] text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono block">
                                      {account.xpub}
                                    </code>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        /* Legacy fallback for devices without accounts array */
                        <div className="surface-muted p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Derivation Path</p>
                              <code className="text-xs text-sanctuary-600 dark:text-sanctuary-300 font-mono">
                                {device.derivationPath || "m/84'/0'/0'"}
                              </code>
                            </div>
                            <div className="md:col-span-2">
                              <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Extended Public Key</p>
                              <code className="text-[10px] text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono block">
                                {device.xpub || 'N/A'}
                              </code>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Add Account Button - only for owners */}
                      {isOwner && (
                        <button
                          onClick={() => setShowAddAccount(true)}
                          className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border-2 border-dashed border-sanctuary-300 dark:border-sanctuary-700 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-400 dark:hover:border-sanctuary-600 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">Add Derivation Path</span>
                        </button>
                      )}

                      {/* Add Account Dialog */}
                      {showAddAccount && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full shadow-xl">
                            <div className="p-6">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-50">
                                  Add Derivation Path
                                </h3>
                                <button
                                  onClick={() => {
                                    setShowAddAccount(false);
                                    setAddAccountMethod(null);
                                    setAddAccountError(null);
                                    resetImportState();
                                  }}
                                  className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                              </div>

                              {!addAccountMethod ? (
                                <div className="space-y-3">
                                  <p className="text-sm text-sanctuary-500 mb-4">
                                    Choose how to add a new derivation path to this device.
                                  </p>

                                  {/* USB Option */}
                                  {isSecureContext() && getDeviceTypeFromDeviceModel() && (
                                    <button
                                      onClick={() => setAddAccountMethod('usb')}
                                      className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
                                    >
                                      <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                                        <Usb className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                      </div>
                                      <div>
                                        <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                          Connect via USB
                                        </p>
                                        <p className="text-xs text-sanctuary-500">
                                          Fetch all derivation paths from device
                                        </p>
                                      </div>
                                    </button>
                                  )}

                                  {/* SD Card Option */}
                                  <button
                                    onClick={() => { setAddAccountMethod('sdcard'); resetImportState(); }}
                                    className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
                                  >
                                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                                      <HardDrive className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                        Import from SD Card
                                      </p>
                                      <p className="text-xs text-sanctuary-500">
                                        Upload export file from device
                                      </p>
                                    </div>
                                  </button>

                                  {/* QR Code Option */}
                                  <button
                                    onClick={() => { setAddAccountMethod('qr'); resetImportState(); }}
                                    className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
                                  >
                                    <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                                      <QrCode className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                        Scan QR Code
                                      </p>
                                      <p className="text-xs text-sanctuary-500">
                                        Scan animated or static QR codes
                                      </p>
                                    </div>
                                  </button>

                                  {/* Manual Option */}
                                  <button
                                    onClick={() => setAddAccountMethod('manual')}
                                    className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
                                  >
                                    <div className="p-2 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
                                      <Edit2 className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                        Enter Manually
                                      </p>
                                      <p className="text-xs text-sanctuary-500">
                                        Enter derivation path and xpub
                                      </p>
                                    </div>
                                  </button>
                                </div>
                              ) : parsedAccounts.length > 0 ? (
                                /* Parsed accounts selection UI */
                                <div className="space-y-4">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300">
                                      Select accounts to add:
                                    </p>
                                    <span className="text-xs text-sanctuary-400">
                                      {selectedParsedAccounts.size} of {parsedAccounts.length}
                                    </span>
                                  </div>

                                  {accountConflict && accountConflict.matchingAccounts.length > 0 && (
                                    <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-xs text-blue-600 dark:text-blue-400">
                                      <Check className="w-3 h-3 inline mr-1" />
                                      {accountConflict.matchingAccounts.length} account(s) already exist
                                    </div>
                                  )}

                                  <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {parsedAccounts.map((account, index) => {
                                      const isSelected = selectedParsedAccounts.has(index);
                                      return (
                                        <label
                                          key={index}
                                          className={`block p-3 rounded-lg border cursor-pointer transition-all ${
                                            isSelected
                                              ? 'border-sanctuary-500 bg-sanctuary-50 dark:bg-sanctuary-800'
                                              : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
                                          }`}
                                        >
                                          <div className="flex items-start gap-2">
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={() => {
                                                const newSelected = new Set(selectedParsedAccounts);
                                                if (isSelected) {
                                                  newSelected.delete(index);
                                                } else {
                                                  newSelected.add(index);
                                                }
                                                setSelectedParsedAccounts(newSelected);
                                              }}
                                              className="mt-1 rounded border-sanctuary-300"
                                            />
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-1 mb-1">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                  account.purpose === 'multisig'
                                                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                                }`}>
                                                  {account.purpose === 'multisig' ? 'Multisig' : 'Single-sig'}
                                                </span>
                                              </div>
                                              <code className="text-xs font-mono text-sanctuary-600 dark:text-sanctuary-300">
                                                {account.derivationPath}
                                              </code>
                                            </div>
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>

                                  <button
                                    onClick={handleAddParsedAccounts}
                                    disabled={selectedParsedAccounts.size === 0 || addAccountLoading}
                                    className="w-full px-4 py-2.5 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                  >
                                    {addAccountLoading ? (
                                      <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Adding...
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="w-4 h-4" />
                                        Add {selectedParsedAccounts.size} Account{selectedParsedAccounts.size !== 1 ? 's' : ''}
                                      </>
                                    )}
                                  </button>
                                </div>
                              ) : addAccountMethod === 'usb' ? (
                                <div className="text-center py-6">
                                  {addAccountLoading ? (
                                    <>
                                      <Loader2 className="w-10 h-10 mx-auto animate-spin text-sanctuary-500 mb-4" />
                                      {usbProgress ? (
                                        <>
                                          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300">
                                            Fetching {usbProgress.name}...
                                          </p>
                                          <p className="text-xs text-sanctuary-400 mt-1">
                                            {usbProgress.current} of {usbProgress.total} paths
                                          </p>
                                          <div className="w-48 mx-auto mt-3 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full h-2">
                                            <div
                                              className="bg-sanctuary-600 dark:bg-sanctuary-400 h-2 rounded-full transition-all duration-300"
                                              style={{ width: `${(usbProgress.current / usbProgress.total) * 100}%` }}
                                            />
                                          </div>
                                        </>
                                      ) : (
                                        <p className="text-sm text-sanctuary-500">Connecting to device...</p>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <Usb className="w-10 h-10 mx-auto text-sanctuary-400 mb-4" />
                                      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-2">
                                        Connect your {device.type} and confirm on device
                                      </p>
                                      <p className="text-xs text-sanctuary-400 mb-4">
                                        This will fetch all standard derivation paths
                                      </p>
                                      <button
                                        onClick={handleAddAccountsViaUsb}
                                        className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
                                      >
                                        Connect Device
                                      </button>
                                    </>
                                  )}
                                </div>
                              ) : addAccountMethod === 'sdcard' ? (
                                /* SD Card file upload */
                                <div className="text-center py-6">
                                  {addAccountLoading ? (
                                    <div className="flex flex-col items-center">
                                      <Loader2 className="w-10 h-10 animate-spin text-sanctuary-500 mb-4" />
                                      <p className="text-sm text-sanctuary-500">Parsing file...</p>
                                    </div>
                                  ) : (
                                    <>
                                      <HardDrive className="w-10 h-10 mx-auto text-sanctuary-400 mb-4" />
                                      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
                                        Upload the export file from your {device.type}
                                      </p>
                                      <label className="cursor-pointer">
                                        <span className="inline-flex items-center justify-center rounded-lg px-6 py-2 bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors">
                                          Select File
                                        </span>
                                        <input
                                          type="file"
                                          className="hidden"
                                          accept=".json,.txt"
                                          onChange={handleFileUpload}
                                        />
                                      </label>
                                    </>
                                  )}
                                </div>
                              ) : addAccountMethod === 'qr' ? (
                                /* QR Code scanning */
                                <div className="space-y-3">
                                  {/* QR Mode Toggle */}
                                  <div className="flex justify-center gap-2">
                                    <button
                                      onClick={() => { setQrMode('camera'); setCameraError(null); }}
                                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                        qrMode === 'camera'
                                          ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
                                          : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                                      }`}
                                    >
                                      <Camera className="w-4 h-4" />
                                      Camera
                                    </button>
                                    <button
                                      onClick={() => { setQrMode('file'); setCameraActive(false); }}
                                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                        qrMode === 'file'
                                          ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
                                          : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                                      }`}
                                    >
                                      <Upload className="w-4 h-4" />
                                      File
                                    </button>
                                  </div>

                                  {/* Camera Scanner */}
                                  {qrMode === 'camera' && (
                                    <div className="surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
                                      {!cameraActive && !cameraError && (
                                        <div className="text-center py-6">
                                          <Camera className="w-10 h-10 mx-auto text-sanctuary-400 mb-3" />
                                          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
                                            Scan QR code from your device
                                          </p>
                                          {!isSecureContext() && (
                                            <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 px-4">
                                              Camera requires HTTPS
                                            </p>
                                          )}
                                          <button
                                            onClick={() => { setCameraActive(true); setCameraError(null); }}
                                            className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
                                          >
                                            Start Camera
                                          </button>
                                        </div>
                                      )}
                                      {cameraActive && (
                                        <div className="relative">
                                          <div className="aspect-square max-w-xs mx-auto">
                                            <Scanner
                                              onScan={handleQrScan}
                                              onError={handleCameraError}
                                              constraints={{ facingMode: 'environment' }}
                                              scanDelay={100}
                                              styles={{
                                                container: { width: '100%', height: '100%' },
                                                video: { width: '100%', height: '100%', objectFit: 'cover' },
                                              }}
                                            />
                                          </div>
                                          <button
                                            onClick={() => { setCameraActive(false); setUrProgress(0); urDecoderRef.current = null; bytesDecoderRef.current = null; }}
                                            className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
                                          >
                                            <X className="w-4 h-4" />
                                          </button>
                                          {/* Progress for animated QR */}
                                          {urProgress > 0 && urProgress < 100 && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-3 z-10">
                                              <div className="flex items-center justify-between text-white mb-2">
                                                <span className="flex items-center text-sm font-medium">
                                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                  Scanning...
                                                </span>
                                                <span className="text-lg font-bold">{urProgress}%</span>
                                              </div>
                                              <div className="w-full bg-white/20 rounded-full h-2">
                                                <div
                                                  className="bg-green-400 h-2 rounded-full transition-all duration-300"
                                                  style={{ width: `${urProgress}%` }}
                                                />
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {cameraError && (
                                        <div className="text-center py-6">
                                          <AlertCircle className="w-10 h-10 mx-auto text-rose-400 mb-3" />
                                          <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
                                            {cameraError}
                                          </p>
                                          <button
                                            onClick={() => { setCameraActive(true); setCameraError(null); }}
                                            className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
                                          >
                                            Try Again
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* File upload alternative */}
                                  {qrMode === 'file' && (
                                    <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                                      {addAccountLoading ? (
                                        <div className="flex flex-col items-center">
                                          <Loader2 className="w-10 h-10 animate-spin text-sanctuary-500 mb-4" />
                                          <p className="text-sm text-sanctuary-500">Parsing file...</p>
                                        </div>
                                      ) : (
                                        <>
                                          <Upload className="w-10 h-10 mx-auto text-sanctuary-400 mb-3" />
                                          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
                                            Upload QR data file
                                          </p>
                                          <label className="cursor-pointer">
                                            <span className="inline-flex items-center justify-center rounded-lg px-6 py-2 bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors">
                                              Select File
                                            </span>
                                            <input
                                              type="file"
                                              className="hidden"
                                              accept=".json,.txt"
                                              onChange={handleFileUpload}
                                            />
                                          </label>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : addAccountMethod === 'manual' ? (
                                <div className="space-y-4">
                                  {/* Purpose */}
                                  <div>
                                    <label className="block text-xs font-medium text-sanctuary-500 mb-1">Purpose</label>
                                    <select
                                      value={manualAccount.purpose}
                                      onChange={(e) => setManualAccount(prev => ({ ...prev, purpose: e.target.value as 'single_sig' | 'multisig' }))}
                                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                    >
                                      <option value="single_sig">Single-sig</option>
                                      <option value="multisig">Multisig</option>
                                    </select>
                                  </div>

                                  {/* Script Type */}
                                  <div>
                                    <label className="block text-xs font-medium text-sanctuary-500 mb-1">Script Type</label>
                                    <select
                                      value={manualAccount.scriptType}
                                      onChange={(e) => setManualAccount(prev => ({ ...prev, scriptType: e.target.value as 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy' }))}
                                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                    >
                                      <option value="native_segwit">Native SegWit (bc1q...)</option>
                                      <option value="taproot">Taproot (bc1p...)</option>
                                      <option value="nested_segwit">Nested SegWit (3...)</option>
                                      <option value="legacy">Legacy (1...)</option>
                                    </select>
                                  </div>

                                  {/* Derivation Path */}
                                  <div>
                                    <label className="block text-xs font-medium text-sanctuary-500 mb-1">Derivation Path</label>
                                    <input
                                      type="text"
                                      value={manualAccount.derivationPath}
                                      onChange={(e) => setManualAccount(prev => ({ ...prev, derivationPath: e.target.value }))}
                                      placeholder="m/48'/0'/0'/2'"
                                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                    />
                                  </div>

                                  {/* XPub */}
                                  <div>
                                    <label className="block text-xs font-medium text-sanctuary-500 mb-1">Extended Public Key</label>
                                    <textarea
                                      value={manualAccount.xpub}
                                      onChange={(e) => setManualAccount(prev => ({ ...prev, xpub: e.target.value }))}
                                      placeholder="xpub..."
                                      rows={3}
                                      className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                    />
                                  </div>

                                  <button
                                    onClick={handleAddAccountManually}
                                    disabled={!manualAccount.xpub || !manualAccount.derivationPath || addAccountLoading}
                                    className="w-full px-4 py-2.5 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                  >
                                    {addAccountLoading ? (
                                      <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Adding...
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="w-4 h-4" />
                                        Add Account
                                      </>
                                    )}
                                  </button>
                                </div>
                              ) : null}

                              {/* Error Message */}
                              {addAccountError && (
                                <p className="mt-4 text-center text-sm text-rose-600 dark:text-rose-400">
                                  {addAccountError}
                                </p>
                              )}

                              {/* Back button when in a method */}
                              {addAccountMethod && !addAccountLoading && (
                                <button
                                  onClick={() => {
                                    setAddAccountMethod(null);
                                    setAddAccountError(null);
                                    resetImportState();
                                  }}
                                  className="mt-4 w-full text-center text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300"
                                >
                                  ← Back to options
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                </div>
            </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-sanctuary-200 dark:border-sanctuary-800">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'details'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('access')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'access'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              <Shield className="w-4 h-4" />
              Access
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'details' && (
          <div className="space-y-4">
               <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Associated Wallets</h3>
               {wallets.length === 0 ? (
                   <div className="surface-elevated rounded-xl p-8 text-center text-sanctuary-400 border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                       No wallets are currently using this device.
                   </div>
               ) : (
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {wallets.map(w => {
                           const isMultisig = isMultisigType(w.type);
                           const badgeClass = isMultisig
                              ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                              : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

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
        )}

        {activeTab === 'access' && (
          <div className="space-y-4">
            {/* Sub-tabs */}
            <div className="flex space-x-1 p-1 surface-secondary rounded-lg w-fit">
              {(['ownership', 'sharing', 'transfers'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAccessSubTab(tab)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                    accessSubTab === tab
                      ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                      : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Ownership Sub-tab */}
            {accessSubTab === 'ownership' && (
              <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
                  <div className="flex items-center">
                    <div className="h-9 w-9 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-base font-bold text-sanctuary-600 dark:text-sanctuary-300">
                      {deviceShareInfo?.users.find(u => u.role === 'owner')?.username?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="ml-3">
                      <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                        {deviceShareInfo?.users.find(u => u.role === 'owner')?.username || user?.username || 'You'}
                      </p>
                      <p className="text-xs text-sanctuary-500">Device Owner</p>
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => setShowTransferModal(true)}
                      className="flex items-center px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      Transfer
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Sharing Sub-tab */}
            {accessSubTab === 'sharing' && (
              <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800 space-y-4">
                {/* Add sharing controls - only for owners */}
                {isOwner && (
                  <div className="p-3 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                    <div className="flex flex-wrap gap-2">
                      {/* Group sharing */}
                      {!deviceShareInfo?.group && (
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedGroupToAdd}
                            onChange={(e) => setSelectedGroupToAdd(e.target.value)}
                            className="text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                          >
                            <option value="">Add group...</option>
                            {groups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                          {selectedGroupToAdd && (
                            <button
                              onClick={addGroup}
                              disabled={sharingLoading}
                              className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
                            >
                              Add as Viewer
                            </button>
                          )}
                        </div>
                      )}
                      {/* User sharing */}
                      <div className="flex-1 min-w-[200px] relative">
                        <input
                          type="text"
                          value={userSearchQuery}
                          onChange={(e) => handleSearchUsers(e.target.value)}
                          placeholder="Add user..."
                          className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                        />
                        {searchingUsers && (
                          <div className="absolute right-2 top-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent" />
                          </div>
                        )}
                        {userSearchResults.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {userSearchResults.map(u => (
                              <div key={u.id} className="px-2 py-1.5 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 flex items-center justify-between">
                                <div className="flex items-center">
                                  <div className="h-5 w-5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                                    {u.username.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-sm">{u.username}</span>
                                </div>
                                <button
                                  onClick={() => handleShareWithUser(u.id)}
                                  disabled={sharingLoading}
                                  className="text-xs px-1.5 py-0.5 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 disabled:opacity-50"
                                >
                                  Add as Viewer
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Current shared access */}
                <div className="space-y-2">
                  {/* Group */}
                  {deviceShareInfo?.group && (
                    <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                      <div className="flex items-center">
                        <Users className="w-4 h-4 text-sanctuary-500 mr-2" />
                        <span className="text-sm font-medium">{deviceShareInfo.group.name}</span>
                        <span className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                          Viewer
                        </span>
                      </div>
                      {isOwner && (
                        <button
                          onClick={removeGroup}
                          disabled={sharingLoading}
                          className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Individual users */}
                  {deviceShareInfo?.users.filter(u => u.role !== 'owner').map(u => (
                    <div key={u.id} className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                      <div className="flex items-center">
                        <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium">{u.username}</span>
                        <span className="ml-2 text-xs text-sanctuary-500 capitalize">{u.role}</span>
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveUserAccess(u.id)}
                          disabled={sharingLoading}
                          className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Empty state */}
                  {!deviceShareInfo?.group && (!deviceShareInfo?.users || deviceShareInfo.users.filter(u => u.role !== 'owner').length === 0) && (
                    <div className="text-center py-6 text-sanctuary-400 text-sm">
                      Not shared with anyone yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Transfers Sub-tab */}
            {accessSubTab === 'transfers' && (
              <PendingTransfersPanel
                resourceType="device"
                resourceId={id!}
                onTransferComplete={handleTransferComplete}
              />
            )}
          </div>
        )}

        {/* Transfer Ownership Modal */}
        {showTransferModal && device && (
          <TransferOwnershipModal
            resourceType="device"
            resourceId={device.id}
            resourceName={device.label}
            onClose={() => setShowTransferModal(false)}
            onTransferInitiated={() => {
              setShowTransferModal(false);
              // Could optionally refresh to show the pending transfer
            }}
          />
        )}
    </div>
  );
};