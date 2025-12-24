import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Wallet, UTXO, FeeEstimate, WalletType, Device } from '../types';
import * as walletsApi from '../src/api/wallets';
import * as transactionsApi from '../src/api/transactions';
import * as bitcoinApi from '../src/api/bitcoin';
import * as devicesApi from '../src/api/devices';
import * as draftsApi from '../src/api/drafts';
import * as payjoinApi from '../src/api/payjoin';
import type { DraftTransaction } from '../src/api/drafts';
import { ApiError } from '../src/api/client';
import { Button } from './ui/Button';
import { BlockVisualizer } from './BlockVisualizer';
import { TransactionFlowPreview, FlowInput, FlowOutput } from './TransactionFlowPreview';
import type { BlockData, QueuedBlocksSummary } from '../src/api/bitcoin';
import { HardwareWalletConnect } from './HardwareWalletConnect';
import { useHardwareWallet } from '../hooks/useHardwareWallet';
import { ArrowLeft, Camera, Check, X, QrCode, Sliders, AlertTriangle, Loader2, Shield, Usb, RefreshCw, ChevronDown, Users, Key, Circle, CheckCircle2, FileDown, Upload, Save, FileText, XCircle, Plus, Trash2 } from 'lucide-react';
import { HardwareDevice } from '../types';
import { getDeviceIcon } from './ui/CustomIcons';
import { useCurrency } from '../contexts/CurrencyContext';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { useNotificationSound } from '../hooks/useNotificationSound';
import { createLogger } from '../utils/logger';
import { calculateFee as calculateTxFee } from '../utils/feeCalculation';
import { parseBip21Uri } from '../utils/bip21Parser';
import { useOutputManagement, OutputEntry } from '../hooks/useOutputManagement';

const log = createLogger('SendTx');

// Device connection capabilities
// Note: Bluetooth is not currently supported
type ConnectionMethod = 'usb' | 'airgap';

interface DeviceCapabilities {
  methods: ConnectionMethod[];
  labels: Record<ConnectionMethod, string>;
}

// Define what connection methods each device type supports
const getDeviceCapabilities = (deviceType: string): DeviceCapabilities => {
  const normalizedType = deviceType.toLowerCase();

  // Coldcard - USB and Air-gap (SD card / QR for Q model)
  if (normalizedType.includes('coldcard')) {
    return {
      methods: ['usb', 'airgap'],
      labels: { usb: 'USB', airgap: 'PSBT File' }
    };
  }

  // Ledger - USB only (Bluetooth not supported)
  if (normalizedType.includes('ledger')) {
    return {
      methods: ['usb'],
      labels: { usb: 'USB', airgap: '' }
    };
  }

  // Trezor - USB only
  if (normalizedType.includes('trezor')) {
    return {
      methods: ['usb'],
      labels: { usb: 'USB', airgap: '' }
    };
  }

  // BitBox02 - USB only
  if (normalizedType.includes('bitbox')) {
    return {
      methods: ['usb'],
      labels: { usb: 'USB', airgap: '' }
    };
  }

  // Foundation Passport - Air-gap only (QR codes, microSD)
  if (normalizedType.includes('passport') || normalizedType.includes('foundation')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', airgap: 'QR / SD Card' }
    };
  }

  // Blockstream Jade - USB only (Bluetooth not supported)
  if (normalizedType.includes('jade') || normalizedType.includes('blockstream')) {
    return {
      methods: ['usb'],
      labels: { usb: 'USB', airgap: '' }
    };
  }

  // Keystone - Air-gap only (QR codes)
  if (normalizedType.includes('keystone')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', airgap: 'QR Code' }
    };
  }

  // SeedSigner - Air-gap only (QR codes)
  if (normalizedType.includes('seedsigner')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', airgap: 'QR Code' }
    };
  }

  // Generic SD card device - Air-gap only
  if (normalizedType.includes('sd card') || normalizedType.includes('sd-card') || normalizedType.includes('airgap') || normalizedType.includes('air-gap')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', airgap: 'PSBT File' }
    };
  }

  // Unknown device - default to USB + Air-gap options
  // This allows users to choose their preferred signing method
  return {
    methods: ['usb', 'airgap'],
    labels: { usb: 'USB', airgap: 'PSBT File' }
  };
};

const getConnectionIcon = (method: ConnectionMethod) => {
  switch (method) {
    case 'usb': return Usb;
    case 'airgap': return FileDown;
  }
};
import { Amount } from './Amount';
import { useUser } from '../contexts/UserContext';
import jsQR from 'jsqr';
import { CoinControlPanel } from './CoinControlPanel';
import type { UIStrategy } from './StrategySelector';
import { PrivacyWarnings, parseWarnings, type PrivacyWarning } from './PrivacyWarnings';

export const SendTransaction: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { format, getFiatValue, currencySymbol, unit } = useCurrency();
  const { user } = useUser();

  // Unit conversion helpers - amounts are stored internally as sats
  const satsToDisplay = (sats: number | string): string => {
    const satsNum = typeof sats === 'string' ? parseInt(sats) || 0 : sats;
    if (unit === 'btc') {
      // Trim trailing zeros from BTC display
      return satsNum > 0 ? (satsNum / 100_000_000).toFixed(8).replace(/\.?0+$/, '') : '';
    }
    return satsNum > 0 ? satsNum.toString() : '';
  };

  const displayToSats = (display: string): string => {
    if (!display || display === '') return '';
    if (unit === 'btc') {
      const btcNum = parseFloat(display) || 0;
      return Math.round(btcNum * 100_000_000).toString();
    }
    return display;
  };

  const unitLabel = unit === 'btc' ? 'BTC' : 'SATS';
  const { handleError, showSuccess, showInfo } = useErrorHandler();
  const { playEventSound } = useNotificationSound();

  // Hardware wallet integration
  const hardwareWallet = useHardwareWallet();
  const [showHWConnect, setShowHWConnect] = useState(false);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [utxos, setUTXOs] = useState<UTXO[]>([]);
  const [fees, setFees] = useState<FeeEstimate | null>(null);
  const [mempoolBlocks, setMempoolBlocks] = useState<BlockData[]>([]);
  const [queuedBlocksSummary, setQueuedBlocksSummary] = useState<QueuedBlocksSummary | null>(null);

  // Multi-output support (using extracted hook)
  const {
    outputs,
    outputsValid,
    scanningOutputIndex,
    isSendMax,
    addOutput,
    removeOutput,
    updateOutput,
    toggleSendMax,
    setOutputsValid,
    setScanningOutputIndex,
    setOutputs,
  } = useOutputManagement();

  const [feeRate, setFeeRate] = useState<number>(0);
  const [selectedUTXOs, setSelectedUTXOs] = useState<Set<string>>(new Set());
  const [showCoinControl, setShowCoinControl] = useState(false);
  const [coinControlStrategy, setCoinControlStrategy] = useState<UIStrategy>('auto');
  const [showScanner, setShowScanner] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enableRBF, setEnableRBF] = useState(true);
  const [subtractFeesFromAmount, setSubtractFeesFromAmount] = useState(false);
  const [enableDecoyOutputs, setEnableDecoyOutputs] = useState(false);
  const [decoyCount, setDecoyCount] = useState(2);

  // Payjoin state
  const [payjoinUrl, setPayjoinUrl] = useState<string | null>(null);
  const [payjoinAttempted, setPayjoinAttempted] = useState(false);
  const [payjoinStatus, setPayjoinStatus] = useState<'idle' | 'attempting' | 'success' | 'failed'>('idle');

  // Privacy warnings state
  const [privacyWarnings, setPrivacyWarnings] = useState<PrivacyWarning[]>([]);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const [loadingPrivacy, setLoadingPrivacy] = useState(false);

  // Backwards compatibility helpers
  const recipient = outputs[0]?.address || '';
  const amount = outputs[0]?.amount || '';
  const setRecipient = (value: string) => updateOutput(0, 'address', value);
  const setAmount = (value: string) => updateOutput(0, 'amount', value);

  // Handle address input that might be a BIP21 URI
  const handleAddressInput = useCallback((index: number, value: string) => {
    const parsed = parseBip21Uri(value);

    if (parsed) {
      // It's a BIP21 URI - extract values
      updateOutput(index, 'address', parsed.address);

      if (parsed.amount && index === 0) {
        updateOutput(index, 'amount', String(parsed.amount));
      }

      if (parsed.payjoinUrl && index === 0) {
        setPayjoinUrl(parsed.payjoinUrl);
        setPayjoinStatus('idle');
        setPayjoinAttempted(false);
        log.info('Detected Payjoin URI', { payjoinUrl: parsed.payjoinUrl });
      } else if (index === 0) {
        setPayjoinUrl(null);
      }
    } else {
      // Regular address
      updateOutput(index, 'address', value);
      if (index === 0) {
        setPayjoinUrl(null);
      }
    }
  }, [updateOutput]);

  // PSBT file handling
  const [showPsbtOptions, setShowPsbtOptions] = useState(false);
  const [unsignedPsbt, setUnsignedPsbt] = useState<string | null>(null);
  const psbtFileInputRef = useRef<HTMLInputElement>(null);

  // Consolidation mode
  const [isConsolidation, setIsConsolidation] = useState(false);
  const [walletAddresses, setWalletAddresses] = useState<string[]>([]);
  const [consolidationAddress, setConsolidationAddress] = useState<string>('');

  // Multisig devices
  const [walletDevices, setWalletDevices] = useState<devicesApi.Device[]>([]);
  const [signedDevices, setSignedDevices] = useState<Set<string>>(new Set()); // Device IDs that have signed
  const [signingDeviceId, setSigningDeviceId] = useState<string | null>(null); // Currently signing device
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null); // Device with expanded connection options
  const [psbtDeviceId, setPsbtDeviceId] = useState<string | null>(null); // Device showing PSBT download/upload options

  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft transaction state
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [existingDraftsCount, setExistingDraftsCount] = useState(0);
  const [showDraftsBanner, setShowDraftsBanner] = useState(false);
  const [isResumingDraft, setIsResumingDraft] = useState(false);
  const [savedDraftTxData, setSavedDraftTxData] = useState<{
    psbtBase64: string;
    fee: number;
    totalInput: number;
    totalOutput: number;
    changeAmount: number;
    effectiveAmount: number;
    utxos: Array<{ txid: string; vout: number }>;
  } | null>(null);
  const draftData = (location.state as { draft?: DraftTransaction })?.draft;
  
  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(null);

  useEffect(() => {
    const init = async () => {
      if (!id || !user) return;

      setLoading(true);
      setError(null);

      // Fetch wallet data - critical for sending
      let apiWallet;
      try {
        apiWallet = await walletsApi.getWallet(id);
      } catch (err) {
        log.error('Failed to fetch wallet', { error: err });
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load wallet');
        }
        setLoading(false);
        return;
      }

      // API returns 'multi_sig' or 'single_sig', convert to WalletType enum values
      const walletType = apiWallet.type === 'multi_sig' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;
      const formattedWallet: Wallet = {
        id: apiWallet.id,
        name: apiWallet.name,
        type: walletType,
        balance: apiWallet.balance,
        scriptType: apiWallet.scriptType,
        derivationPath: apiWallet.descriptor || '',
        fingerprint: apiWallet.fingerprint || '',
        label: apiWallet.name,
        xpub: '',
        unit: 'sats',
        ownerId: user.id,
        groupIds: [],
        quorum: apiWallet.quorum && apiWallet.totalSigners
          ? { m: apiWallet.quorum, n: apiWallet.totalSigners }
          : { m: 1, n: 1 },
        descriptor: apiWallet.descriptor,
        deviceIds: [],
      };
      setWallet(formattedWallet);

      // Fetch UTXOs, fees, addresses, and mempool data - all needed for sending transactions
      try {
        const [utxoData, feeEstimates, mempoolData, addressData] = await Promise.all([
          transactionsApi.getUTXOs(id),
          bitcoinApi.getFeeEstimates(),
          bitcoinApi.getMempoolData().catch(() => null), // Don't fail if mempool data unavailable
          transactionsApi.getAddresses(id).catch(() => []) // Fetch addresses for consolidation
        ]);

        // Format UTXOs (include frozen status and draft lock for coin control)
        const formattedUTXOs: UTXO[] = utxoData.utxos.map(utxo => ({
          id: utxo.id,
          txid: utxo.txid,
          vout: utxo.vout,
          amount: Number(utxo.amount),
          address: utxo.address,
          confirmations: utxo.confirmations,
          spendable: utxo.spendable,
          scriptType: formattedWallet.scriptType,
          frozen: utxo.frozen ?? false,
          lockedByDraftId: utxo.lockedByDraftId,
          lockedByDraftLabel: utxo.lockedByDraftLabel,
        }));
        setUTXOs(formattedUTXOs);

        // Create a set of frozen UTXO IDs for filtering
        const frozenUtxoIds = new Set(
          formattedUTXOs.filter(u => u.frozen).map(u => `${u.txid}:${u.vout}`)
        );

        // Format fees
        const formattedFees: FeeEstimate = {
          fastestFee: feeEstimates.fastest,
          halfHourFee: feeEstimates.hour,
          hourFee: feeEstimates.economy,
          economyFee: feeEstimates.minimum || 1,
          minimumFee: feeEstimates.minimum || 1,
        };
        setFees(formattedFees);
        setFeeRate(feeEstimates.hour); // Default to standard

        // Set block data for visualizer (same format as Dashboard)
        if (mempoolData) {
          const allBlocks = [...mempoolData.mempool, ...mempoolData.blocks];
          setMempoolBlocks(allBlocks);
          setQueuedBlocksSummary(mempoolData.queuedBlocksSummary || null);
        }

        // Set wallet addresses for consolidation feature
        if (addressData && addressData.length > 0) {
          // Filter to only receive addresses (not change) for consolidation
          const receiveAddresses = addressData
            .filter(addr => !addr.derivationPath.includes('/1/'))
            .map(addr => addr.address);
          setWalletAddresses(receiveAddresses);
          // Set first unused address as default consolidation address
          const unusedAddress = addressData.find(addr =>
            !addr.derivationPath.includes('/1/') && !addr.used
          );
          if (unusedAddress) {
            setConsolidationAddress(unusedAddress.address);
          } else if (receiveAddresses.length > 0) {
            setConsolidationAddress(receiveAddresses[0]);
          }
        }

        // Fetch devices for this wallet (both single-sig and multisig)
        try {
          const allDevices = await devicesApi.getDevices();
          // Filter to only devices that are part of this wallet
          const walletDeviceList = allDevices.filter(d =>
            d.wallets?.some(w => w.wallet.id === id)
          );
          setWalletDevices(walletDeviceList);
        } catch (err) {
          log.error('Failed to fetch devices', { error: err });
          // Non-critical, don't block the page
        }

        // Handle Pre-selected UTXOs from Wallet View (filter out frozen ones)
        if (location.state && (location.state as any).preSelected) {
          const pre = (location.state as any).preSelected as string[];
          if (pre.length > 0) {
            // Filter out frozen UTXOs from preselection
            const validPre = pre.filter(utxoId => !frozenUtxoIds.has(utxoId));
            if (validPre.length !== pre.length) {
              showInfo(`${pre.length - validPre.length} frozen UTXO${pre.length - validPre.length > 1 ? 's' : ''} removed from selection`);
            }
            setSelectedUTXOs(new Set(validPre));
            setShowCoinControl(true);
          }
        }

        // Handle draft resume - populate form with saved draft data
        if (draftData) {
          setCurrentDraftId(draftData.id);
          setIsResumingDraft(true);
          setFeeRate(draftData.feeRate);
          setEnableRBF(draftData.enableRBF);
          setSubtractFeesFromAmount(draftData.subtractFees);

          // Restore multiple outputs if they exist, otherwise use single recipient/amount
          // Note: When restoring, we use the saved amounts (not recalculated MAX) since UTXOs may have changed
          if (draftData.outputs && draftData.outputs.length > 0) {
            const restoredOutputs = draftData.outputs.map(o => ({
              address: o.address,
              amount: o.amount.toString(), // Always use saved amount (includes calculated MAX values)
              sendMax: false, // Don't restore sendMax - use fixed amounts from when draft was saved
            }));
            setOutputs(restoredOutputs);
            setOutputsValid(restoredOutputs.map(() => null)); // Will be validated by useEffect
          } else {
            // Single output (backwards compatibility)
            setOutputs([{
              address: draftData.recipient,
              amount: draftData.amount.toString(), // Use saved amount
              sendMax: false, // Don't restore sendMax
            }]);
            setOutputsValid([null]); // Will be validated by useEffect
          }

          // Auto-detect consolidation mode: check if recipient is a wallet address
          // Use all wallet addresses (both receive and change) for consolidation detection
          const allAddresses = addressData?.map(a => a.address) || [];
          if (allAddresses.includes(draftData.recipient)) {
            setIsConsolidation(true);
            // Verify the address still exists in the wallet
            if (!allAddresses.includes(draftData.recipient)) {
              setError('Consolidation address no longer exists in wallet. Please select a new address.');
            }
          }

          // Filter out frozen/spent/unavailable UTXOs from selected set when resuming
          if (draftData.selectedUtxoIds && draftData.selectedUtxoIds.length > 0) {
            let validUtxoIds: string[];

            if (draftData.isRBF) {
              // For RBF drafts, trust the saved UTXOs without checking spendability
              // These UTXOs are from the pending transaction being replaced, so they
              // appear as "in use" but are valid for RBF replacement
              validUtxoIds = draftData.selectedUtxoIds;
            } else {
              // Create a set of available (not spent, not frozen) UTXO IDs
              const availableUtxoIds = new Set(
                formattedUTXOs
                  .filter(u => u.spendable && !u.frozen)
                  .map(u => `${u.txid}:${u.vout}`)
              );

              // Filter to only UTXOs that are still available
              validUtxoIds = draftData.selectedUtxoIds.filter(utxoId => availableUtxoIds.has(utxoId));

              // Warn if some UTXOs were removed
              const removedCount = draftData.selectedUtxoIds.length - validUtxoIds.length;
              if (removedCount > 0) {
                showInfo(`${removedCount} UTXO${removedCount > 1 ? 's' : ''} no longer available (spent or frozen)`);
              }
            }

            if (validUtxoIds.length > 0) {
              setSelectedUTXOs(new Set(validUtxoIds));
              setShowCoinControl(true);
            }
          }
          // Save the draft's PSBT and transaction data for use when signing
          const psbtToUse = draftData.signedPsbtBase64 || draftData.psbtBase64;
          if (psbtToUse) {
            setUnsignedPsbt(psbtToUse);
            // Convert selectedUtxoIds (strings like "txid:vout") to utxos array
            const utxos = (draftData.selectedUtxoIds || []).map(id => {
              const [txid, voutStr] = id.split(':');
              return { txid, vout: parseInt(voutStr, 10) };
            });
            // Store the saved transaction data so we don't need to re-create
            setSavedDraftTxData({
              psbtBase64: psbtToUse,
              fee: draftData.fee,
              totalInput: draftData.totalInput,
              totalOutput: draftData.totalOutput,
              changeAmount: draftData.changeAmount,
              effectiveAmount: draftData.effectiveAmount,
              utxos,
            });
          }
          if (draftData.signedDeviceIds && draftData.signedDeviceIds.length > 0) {
            setSignedDevices(new Set(draftData.signedDeviceIds));
          }
        }
      } catch (err) {
        log.error('Failed to fetch UTXOs or fees', { error: err });
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load UTXOs or fee estimates');
        }
        setLoading(false);
        return;
      }

      // Check for existing drafts (only if not resuming a draft)
      if (!draftData) {
        try {
          const existingDrafts = await draftsApi.getDrafts(id);
          if (existingDrafts.length > 0) {
            setExistingDraftsCount(existingDrafts.length);
            setShowDraftsBanner(true);
          }
        } catch (err) {
          // Non-critical - don't block if drafts check fails
          log.error('Failed to check for existing drafts', { error: err });
        }
      }

      setLoading(false);
    };
    init();

    return () => stopCamera();
  }, [id, location.state, user, draftData]);

  const startCamera = async () => {
    setShowScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.play();
        requestAnimationFrame(tick);
      }
    } catch (err) {
      log.error('Camera error', { error: err });
      handleError('Unable to access camera. Please check your browser permissions.', 'Camera Error');
      setShowScanner(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  };

  const tick = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          if (code) {
             // Use handleAddressInput to parse BIP21 URIs (including Payjoin)
             const outputIndex = scanningOutputIndex ?? 0;
             handleAddressInput(outputIndex, code.data);
             setShowScanner(false);
             setScanningOutputIndex(null);
             stopCamera();
             return;
          }
        }
      }
    }
    animationRef.current = requestAnimationFrame(tick);
  };

  const toggleUTXO = (utxoId: string) => {
      const next = new Set(selectedUTXOs);
      if (next.has(utxoId)) {
          next.delete(utxoId);
      } else {
          next.add(utxoId);
      }
      setSelectedUTXOs(next);
  };

  // Calculate total from selected UTXOs
  const selectedTotal = useMemo(() => {
    return utxos
      .filter(u => selectedUTXOs.has(`${u.txid}:${u.vout}`))
      .reduce((acc, u) => acc + u.amount, 0);
  }, [utxos, selectedUTXOs]);

  // Get spendable UTXOs (not frozen and meets confirmation threshold)
  const spendableUtxos = useMemo(() => {
    return utxos.filter(u => u.spendable !== false && !u.frozen);
  }, [utxos]);

  // Calculate transaction fee given inputs, outputs, and fee rate
  const calculateFee = useCallback((numInputs: number, numOutputs: number, rate: number) => {
    return calculateTxFee(numInputs, numOutputs, rate, wallet?.scriptType);
  }, [wallet?.scriptType]);

  // Calculate total fee for current transaction (for display purposes)
  const calculateTotalFee = useCallback(() => {
    // Determine number of inputs
    let numInputs: number;
    if (showCoinControl && selectedUTXOs.size > 0) {
      numInputs = selectedUTXOs.size;
    } else {
      // Estimate: use minimum number of UTXOs needed to cover amount + fee
      // For simplicity, estimate 1-3 inputs based on amount vs balance ratio
      const amountNeeded = parseInt(amount || '0');
      if (amountNeeded === 0) {
        numInputs = 1;
      } else {
        // Rough estimate: sort UTXOs by amount desc, count how many needed
        const sorted = [...spendableUtxos].sort((a, b) => b.amount - a.amount);
        let running = 0;
        numInputs = 0;
        for (const u of sorted) {
          running += u.amount;
          numInputs++;
          if (running >= amountNeeded + calculateFee(numInputs, 2, feeRate)) break;
        }
        numInputs = Math.max(1, numInputs);
      }
    }

    // Number of outputs: 1 for sendMax (no change), 2 for normal (recipient + change)
    const numOutputs = isSendMax ? 1 : 2;

    return calculateFee(numInputs, numOutputs, feeRate);
  }, [showCoinControl, selectedUTXOs.size, amount, spendableUtxos, isSendMax, feeRate, calculateFee]);

  // Calculate maximum sendable amount for a specific output (accounting for other outputs)
  const calculateMaxForOutput = useMemo(() => {
    return (outputIndex: number) => {
      // Determine available balance
      let availableBalance: number;
      let numInputs: number;

      if (showCoinControl && selectedUTXOs.size > 0) {
        availableBalance = selectedTotal;
        numInputs = selectedUTXOs.size;
      } else if (showCoinControl) {
        return 0;
      } else {
        availableBalance = spendableUtxos.reduce((sum, u) => sum + u.amount, 0);
        numInputs = spendableUtxos.length;
      }

      if (availableBalance <= 0 || numInputs === 0) return 0;

      // Sum of other outputs' amounts (excluding the sendMax output)
      const otherOutputsTotal = outputs.reduce((sum, o, i) => {
        if (i === outputIndex || o.sendMax) return sum;
        return sum + (parseInt(o.amount) || 0);
      }, 0);

      // Number of outputs (sendMax means no change output)
      const hasSendMax = outputs.some(o => o.sendMax);
      const numOutputs = hasSendMax ? outputs.length : outputs.length + 1;
      const estimatedFee = calculateFee(numInputs, numOutputs, feeRate);

      // Max for this output = available - other outputs - fee
      return Math.max(0, availableBalance - otherOutputsTotal - estimatedFee);
    };
  }, [showCoinControl, selectedUTXOs.size, selectedTotal, spendableUtxos, outputs, feeRate, calculateFee]);

  // Calculate max sendable for display - remaining unallocated balance
  const maxSendableAmount = useMemo(() => {
    // If any output has sendMax, all remaining balance is allocated to it, so max sendable is 0
    if (outputs.some(o => o.sendMax)) {
      return 0;
    }

    // No sendMax output - calculate remaining balance after all fixed outputs
    let availableBalance: number;
    let numInputs: number;

    if (showCoinControl && selectedUTXOs.size > 0) {
      availableBalance = selectedTotal;
      numInputs = selectedUTXOs.size;
    } else if (showCoinControl) {
      return 0;
    } else {
      availableBalance = spendableUtxos.reduce((sum, u) => sum + u.amount, 0);
      numInputs = spendableUtxos.length;
    }

    if (availableBalance <= 0 || numInputs === 0) return 0;

    // Sum all output amounts
    const totalOutputs = outputs.reduce((sum, o) => sum + (parseInt(o.amount) || 0), 0);

    // Estimate fee (outputs + change)
    const numOutputs = outputs.length + 1; // +1 for change
    const estimatedFee = calculateFee(numInputs, numOutputs, feeRate);

    return Math.max(0, availableBalance - totalOutputs - estimatedFee);
  }, [outputs, showCoinControl, selectedUTXOs.size, selectedTotal, spendableUtxos, feeRate, calculateFee]);

  // Note: For sendMax outputs, the displayed value is calculated dynamically via calculateMaxForOutput(index)
  // No useEffect needed to update amounts - the input field shows the calculated value directly when sendMax is true

  // Prepare data for transaction flow preview
  const flowPreviewData = useMemo(() => {
    const estimatedFee = calculateTotalFee();

    // Determine which UTXOs will be used as inputs
    let inputUtxos: UTXO[] = [];
    if (showCoinControl && selectedUTXOs.size > 0) {
      inputUtxos = utxos.filter(u => selectedUTXOs.has(`${u.txid}:${u.vout}`));
    } else if (!showCoinControl && spendableUtxos.length > 0) {
      // Estimate: select UTXOs to cover the total amount needed
      // When subtractFees is enabled, fee comes from the amount, not added to it
      const baseAmount = outputs.reduce((sum, o) => {
        if (o.sendMax) return sum;
        return sum + (parseInt(o.amount) || 0);
      }, 0);
      const totalNeeded = subtractFeesFromAmount ? baseAmount : baseAmount + estimatedFee;

      const sorted = [...spendableUtxos].sort((a, b) => b.amount - a.amount);
      let running = 0;
      for (const u of sorted) {
        inputUtxos.push(u);
        running += u.amount;
        if (running >= totalNeeded) break;
      }
    }

    // Prepare inputs for preview
    const flowInputs: FlowInput[] = inputUtxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address,
      amount: u.amount,
      label: u.label,
    }));

    // Prepare outputs for preview
    // When subtractFees is enabled, the recipient receives amount - fee
    const flowOutputs: FlowOutput[] = outputs
      .filter(o => o.address && o.address.length > 0)
      .map((o, idx) => {
        let outputAmount: number;
        if (o.sendMax) {
          outputAmount = calculateMaxForOutput(idx);
        } else {
          const enteredAmount = parseInt(o.amount) || 0;
          // If subtracting fees and this is the first (or only) output, subtract fee from it
          outputAmount = subtractFeesFromAmount && idx === 0 && !isSendMax
            ? Math.max(0, enteredAmount - estimatedFee)
            : enteredAmount;
        }
        return {
          address: o.address,
          amount: outputAmount,
          isChange: false,
          label: subtractFeesFromAmount && idx === 0 && !isSendMax && !o.sendMax
            ? `(fee subtracted)`
            : undefined,
        };
      });

    // Calculate totals
    const totalInput = flowInputs.reduce((sum, i) => sum + i.amount, 0);
    const totalOutputAmount = flowOutputs.reduce((sum, o) => sum + o.amount, 0);

    // Add estimated change output if not sendMax and there's remaining balance
    // When subtractFees is enabled, change = totalInput - original amount (fee already taken from output)
    if (!isSendMax) {
      const originalAmount = outputs.reduce((sum, o) => sum + (parseInt(o.amount) || 0), 0);
      const changeAmount = subtractFeesFromAmount
        ? totalInput - originalAmount
        : totalInput - totalOutputAmount - estimatedFee;

      if (changeAmount > 546) { // Dust threshold
        flowOutputs.push({
          address: 'Change address',
          amount: changeAmount,
          isChange: true,
        });
      }
    }

    const finalTotalOutput = flowOutputs.reduce((sum, o) => sum + o.amount, 0);

    return {
      inputs: flowInputs,
      outputs: flowOutputs,
      fee: estimatedFee,
      totalInput,
      totalOutput: finalTotalOutput,
    };
  }, [utxos, spendableUtxos, selectedUTXOs, showCoinControl, outputs, calculateMaxForOutput, calculateTotalFee, isSendMax, subtractFeesFromAmount]);

  // Determine if we should show the flow preview
  const showFlowPreview = useMemo(() => {
    // Show preview when we have at least one valid output address
    const hasValidOutput = outputs.some((o, idx) => o.address && o.address.length > 10 && outputsValid[idx] !== false);
    // And we have some inputs (either selected or available)
    const hasInputs = (showCoinControl && selectedUTXOs.size > 0) || (!showCoinControl && spendableUtxos.length > 0);
    return hasValidOutput && hasInputs;
  }, [outputs, outputsValid, showCoinControl, selectedUTXOs.size, spendableUtxos.length]);

  // Calculate fee warning - warn if fee is high relative to send amount
  const feeWarning = useMemo(() => {
    const fee = calculateTotalFee();
    // Get total send amount (excluding change)
    const sendAmount = outputs.reduce((sum, o, idx) => {
      if (o.sendMax) return sum + calculateMaxForOutput(idx);
      return sum + (parseInt(o.amount) || 0);
    }, 0);

    if (sendAmount <= 0 || fee <= 0) return null;

    const feePercent = (fee / sendAmount) * 100;

    if (feePercent >= 50) {
      return { level: 'critical', percent: feePercent, message: 'Fee is more than half of the amount you\'re sending!' };
    } else if (feePercent >= 25) {
      return { level: 'critical', percent: feePercent, message: 'Fee is more than 25% of the amount you\'re sending' };
    } else if (feePercent >= 10) {
      return { level: 'warning', percent: feePercent, message: 'Fee is more than 10% of the amount you\'re sending' };
    }
    return null;
  }, [calculateTotalFee, outputs, calculateMaxForOutput]);

  // Check if any output has invalid address
  const hasInvalidAddress = outputsValid.some(v => v === false);
  const allOutputsHaveAddress = outputs.every(o => o.address && o.address.length > 0);

  // Check if transaction can be created
  const canCreateTransaction = () => {
    if (!allOutputsHaveAddress || hasInvalidAddress || error) return false;
    // Check all outputs have amounts (or sendMax)
    if (!outputs.every(o => o.sendMax || (o.amount && parseInt(o.amount) > 0))) return false;
    if (!isSendMax && showCoinControl && selectedTotal < (parseInt(amount || '0') + calculateTotalFee())) return false;
    return true;
  };

  // Calculate fiat value for input hint
  const amountInSats = parseInt(amount || '0');
  const amountInFiat = getFiatValue(amountInSats).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Validate all output addresses
  useEffect(() => {
    const validateAllAddresses = async () => {
      const newValidStates: (boolean | null)[] = [];

      for (let i = 0; i < outputs.length; i++) {
        const address = outputs[i].address;

        if (!address || address.length < 10) {
          newValidStates.push(null);
          continue;
        }

        // In consolidation mode (first output only), if the address is in our wallet, it's valid
        if (i === 0 && isConsolidation && walletAddresses.includes(address)) {
          newValidStates.push(true);
          continue;
        }

        try {
          const result = await bitcoinApi.validateAddress({ address });
          newValidStates.push(result.valid);
        } catch (err) {
          log.error('Address validation error', { error: err, index: i });
          newValidStates.push(false);
        }
      }

      setOutputsValid(newValidStates);
    };

    const timer = setTimeout(validateAllAddresses, 500); // Debounce
    return () => clearTimeout(timer);
  }, [outputs, isConsolidation, walletAddresses]);

  // Analyze privacy warnings when UTXOs are selected
  useEffect(() => {
    if (!id || selectedUTXOs.size === 0) {
      setPrivacyWarnings([]);
      return;
    }

    const analyzePrivacy = async () => {
      setLoadingPrivacy(true);
      try {
        const utxoIds = Array.from(selectedUTXOs);
        const analysis = await transactionsApi.analyzeSpendPrivacy(id, utxoIds);
        setPrivacyWarnings(parseWarnings(analysis.warnings));
      } catch (err) {
        log.error('Privacy analysis failed', { error: err });
        // Don't show error to user - privacy warnings are optional
      } finally {
        setLoadingPrivacy(false);
      }
    };

    const timer = setTimeout(analyzePrivacy, 300); // Debounce
    return () => clearTimeout(timer);
  }, [id, selectedUTXOs]);

  // Handle transaction broadcast
  const handleBroadcast = async () => {
    if (!wallet || !id) return;

    try {
      setBroadcasting(true);
      setError(null);

      // Validate all outputs
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        if (!output.address) {
          setError(`Output ${i + 1}: Please enter a recipient address`);
          return;
        }
        if (!output.sendMax && (!output.amount || parseInt(output.amount) <= 0)) {
          setError(`Output ${i + 1}: Please enter a valid amount`);
          return;
        }
      }

      // Check for any invalid addresses
      const invalidIndex = outputsValid.findIndex(v => v === false);
      if (invalidIndex !== -1) {
        setError(`Output ${invalidIndex + 1}: Invalid Bitcoin address`);
        return;
      }

      // Prepare outputs for API
      const apiOutputs = outputs.map(o => ({
        address: o.address,
        amount: o.sendMax ? 0 : parseInt(o.amount),
        sendMax: o.sendMax,
      }));

      const totalAmount = apiOutputs.reduce((sum, o) => sum + (o.sendMax ? 0 : o.amount), 0);

      // Step 1: Get or create transaction PSBT
      let txData: any;

      // If resuming a draft with saved transaction data, use it directly instead of re-creating
      if (isResumingDraft && savedDraftTxData) {
        log.info('Using saved draft transaction data', { draftId: currentDraftId });
        txData = {
          psbtBase64: savedDraftTxData.psbtBase64,
          fee: savedDraftTxData.fee,
          totalInput: savedDraftTxData.totalInput,
          totalOutput: savedDraftTxData.totalOutput,
          changeAmount: savedDraftTxData.changeAmount,
          effectiveAmount: savedDraftTxData.effectiveAmount,
          utxos: savedDraftTxData.utxos,
        };
      } else if (outputs.length > 1 || outputs.some(o => o.sendMax)) {
        // Use batch API for multiple outputs or sendMax
        txData = await transactionsApi.createBatchTransaction(id, {
          outputs: apiOutputs,
          feeRate,
          selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
          enableRBF,
        });
      } else {
        // Single output - use original API for backwards compatibility
        txData = await transactionsApi.createTransaction(id, {
          recipient: outputs[0].address,
          amount: parseInt(outputs[0].amount),
          feeRate,
          selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
          enableRBF,
          sendMax: false,
          subtractFees: subtractFeesFromAmount,
          decoyOutputs: enableDecoyOutputs ? { enabled: true, count: decoyCount } : undefined,
        });
      }

      // Check if balance is sufficient (skip for sendMax, subtractFees, or draft resume since already validated)
      if (!isSendMax && !subtractFeesFromAmount && !isResumingDraft) {
        const totalNeeded = totalAmount + txData.fee;
        if (wallet.balance < totalNeeded) {
          setError(`Insufficient funds. Need ${format(totalNeeded)} but have ${format(wallet.balance)}`);
          return;
        }
      }

      // Calculate effective amount for display
      const effectiveAmount = txData.effectiveAmount || (txData.outputs
        ? txData.outputs.reduce((sum: number, o: any) => sum + o.amount, 0)
        : totalAmount);

      // Step 1.5: Attempt Payjoin if detected (single output only)
      let psbtToSign = txData.psbtBase64;
      if (payjoinUrl && outputs.length === 1 && !payjoinAttempted) {
        setPayjoinStatus('attempting');
        setPayjoinAttempted(true);
        log.info('Attempting Payjoin', { payjoinUrl });

        try {
          const payjoinResult = await payjoinApi.attemptPayjoin(txData.psbtBase64, payjoinUrl);

          if (payjoinResult.success && payjoinResult.proposalPsbt) {
            // Payjoin succeeded - use the proposal PSBT
            psbtToSign = payjoinResult.proposalPsbt;
            setPayjoinStatus('success');
            log.info('Payjoin successful, using proposal PSBT');
          } else {
            // Payjoin failed - fall back to regular transaction
            setPayjoinStatus('failed');
            log.warn('Payjoin failed, falling back to regular transaction', { error: payjoinResult.error });
          }
        } catch (pjError) {
          // Payjoin error - fall back to regular transaction
          setPayjoinStatus('failed');
          log.warn('Payjoin error, falling back to regular transaction', { error: pjError });
        }
      }

      // Update txData with the PSBT to sign (either original or Payjoin proposal)
      txData.psbtBase64 = psbtToSign;

      // Step 2: Sign and broadcast
      let signedPsbt: string | undefined;
      let rawTxHex: string | undefined; // Raw transaction hex from Trezor

      // Case 1: Signed PSBT was uploaded via file
      if (signedDevices.has('psbt-signed') && unsignedPsbt) {
        signedPsbt = unsignedPsbt; // This now contains the signed PSBT
      }
      // Case 2: Sign with connected hardware wallet
      else if (hardwareWallet.isConnected && hardwareWallet.device) {
        try {
          const signResult = await hardwareWallet.signPSBT(txData.psbtBase64);
          signedPsbt = signResult.psbt;
          rawTxHex = signResult.rawTx; // Trezor returns fully signed tx directly
        } catch (hwError) {
          log.error('Hardware wallet signing failed', { error: hwError });
          setError(hwError instanceof Error ? hwError.message : 'Hardware wallet signing failed');
          return;
        }
      }

      // Step 3: Broadcast if we have a signed PSBT or raw tx
      if (signedPsbt || rawTxHex) {
        try {
          const broadcastResult = await transactionsApi.broadcastTransaction(id, {
            signedPsbtBase64: signedPsbt,
            rawTxHex: rawTxHex, // For Trezor: broadcast raw tx directly
            recipient: outputs[0].address, // Primary recipient for logging
            amount: effectiveAmount,
            fee: txData.fee,
            utxos: txData.utxos,
          });

          const outputsMsg = outputs.length > 1 ? `${outputs.length} outputs` : format(effectiveAmount);
          showSuccess(
            `Transaction broadcast successfully! TXID: ${broadcastResult.txid.substring(0, 16)}... Amount: ${outputsMsg}, Fee: ${format(txData.fee)}`,
            'Transaction Broadcast'
          );

          // Play send notification sound
          playEventSound('send');

          // Reset signing state
          setSignedDevices(new Set());
          setUnsignedPsbt(null);

          // Delete draft after successful broadcast
          if (currentDraftId) {
            try {
              await draftsApi.deleteDraft(id, currentDraftId);
            } catch (e) {
              log.error('Failed to delete draft after broadcast', { error: e });
            }
          }

          navigate(`/wallets/${id}`);
          return;
        } catch (broadcastError) {
          log.error('Transaction broadcast failed', { error: broadcastError });
          setError(broadcastError instanceof Error ? broadcastError.message : 'Failed to broadcast transaction');
          return;
        }
      }

      // If no signing method available, try to connect hardware wallet directly
      // If we know the device type, connect directly instead of showing a picker
      const singleSigDevice = walletDevices.length > 0 ? walletDevices[0] : null;
      if (singleSigDevice) {
        const deviceType = singleSigDevice.type?.toLowerCase() || '';
        const hwType = deviceType.includes('ledger') ? 'ledger' :
                       deviceType.includes('trezor') ? 'trezor' :
                       deviceType.includes('coldcard') ? 'coldcard' :
                       deviceType.includes('bitbox') ? 'bitbox' :
                       deviceType.includes('jade') ? 'jade' : null;

        if (hwType) {
          showInfo(
            `Connecting to ${singleSigDevice.label || hwType}...`,
            'Hardware Wallet'
          );
          try {
            await hardwareWallet.connect(hwType);
            // After connection, retry broadcast automatically
            // Don't call handleBroadcast recursively - user needs to click again
            return;
          } catch (connErr) {
            log.error('Direct connection failed, showing picker', { error: connErr });
          }
        }
      }

      // Fallback: show connection prompt
      showInfo(
        `Transaction ready for signing. Connect a hardware wallet or use PSBT file signing.`,
        'Sign Transaction'
      );
      setShowHWConnect(true);

    } catch (err) {
      log.error('Transaction broadcast error', { error: err });
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create or broadcast transaction');
      }
    } finally {
      setBroadcasting(false);
    }
  };

  // Handle hardware wallet connection
  const handleHWConnect = async (type: any) => {
    try {
      await hardwareWallet.connect(type);
      setShowHWConnect(false);
      // After connection, user can try broadcasting again
    } catch (err) {
      // Error handled by hardware wallet hook
      log.error('Hardware wallet connection failed', { error: err });
    }
  };

  // Save transaction as draft for later signing/broadcast
  const handleSaveAsDraft = async () => {
    if (!wallet || !id) return;

    try {
      setSavingDraft(true);
      setError(null);

      // Validate all outputs
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        if (!output.address) {
          setError(`Output ${i + 1}: Please enter a recipient address`);
          return;
        }
        if (!output.sendMax && (!output.amount || parseInt(output.amount) <= 0)) {
          setError(`Output ${i + 1}: Please enter a valid amount`);
          return;
        }
      }

      // Check for any invalid addresses
      const invalidIndex = outputsValid.findIndex(v => v === false);
      if (invalidIndex !== -1) {
        setError(`Output ${invalidIndex + 1}: Invalid Bitcoin address`);
        return;
      }

      // Prepare outputs for API
      const apiOutputs = outputs.map(o => ({
        address: o.address,
        amount: o.sendMax ? 0 : parseInt(o.amount),
        sendMax: o.sendMax,
      }));

      const totalAmount = apiOutputs.reduce((sum, o) => sum + (o.sendMax ? 0 : o.amount), 0);

      // Create PSBT for the draft
      let txData: any;
      if (outputs.length > 1 || outputs.some(o => o.sendMax)) {
        txData = await transactionsApi.createBatchTransaction(id, {
          outputs: apiOutputs,
          feeRate,
          selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
          enableRBF,
        });
      } else {
        txData = await transactionsApi.createTransaction(id, {
          recipient: outputs[0].address,
          amount: parseInt(outputs[0].amount),
          feeRate,
          selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
          enableRBF,
          sendMax: false,
          subtractFees: subtractFeesFromAmount,
          decoyOutputs: enableDecoyOutputs ? { enabled: true, count: decoyCount } : undefined,
        });
      }

      // Calculate effective amount for display
      const effectiveAmount = txData.outputs
        ? txData.outputs.reduce((sum: number, o: any) => sum + o.amount, 0)
        : totalAmount || parseInt(outputs[0].amount);

      // Use UTXOs from transaction response (captures auto-selected UTXOs, not just manually selected ones)
      const usedUtxoIds = txData.utxos?.map((u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`) || [];

      // Merge calculated amounts from txData.outputs with sendMax flags from apiOutputs
      // txData.outputs has the actual calculated amounts (including for sendMax outputs)
      const outputsToSave = txData.outputs
        ? txData.outputs.map((txOutput: any, idx: number) => ({
            address: txOutput.address,
            amount: txOutput.amount, // Use calculated amount from transaction
            sendMax: apiOutputs[idx]?.sendMax || false, // Preserve sendMax flag
          }))
        : apiOutputs;

      const draftRequest: draftsApi.CreateDraftRequest = {
        recipient: outputs[0].address,
        amount: effectiveAmount,
        feeRate,
        selectedUtxoIds: usedUtxoIds.length > 0 ? usedUtxoIds : undefined,
        enableRBF,
        subtractFees: subtractFeesFromAmount,
        sendMax: isSendMax,
        outputs: outputsToSave, // Save with calculated amounts for accurate restoration
        psbtBase64: txData.psbtBase64,
        fee: txData.fee,
        totalInput: txData.totalInput,
        totalOutput: txData.totalOutput,
        changeAmount: txData.changeAmount || 0,
        changeAddress: txData.changeAddress,
        effectiveAmount: txData.effectiveAmount,
        inputPaths: txData.inputPaths || [],
      };

      if (currentDraftId) {
        // Update existing draft (only signing info changes, amounts are locked)
        await draftsApi.updateDraft(id, currentDraftId, {
          signedPsbtBase64: unsignedPsbt || undefined,
          status: signedDevices.size > 0 ? 'partial' : 'unsigned',
        });
        showSuccess('Draft updated successfully', 'Draft Saved');
      } else {
        // Create new draft
        const draft = await draftsApi.createDraft(id, draftRequest);
        setCurrentDraftId(draft.id);
        showSuccess('Transaction saved as draft. You can resume signing later from the Drafts tab.', 'Draft Saved');
      }

      // Navigate back to wallet with drafts tab active
      navigate(`/wallets/${id}`, { state: { activeTab: 'drafts' } });
    } catch (err) {
      log.error('Save draft error', { error: err });
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to save draft');
      }
    } finally {
      setSavingDraft(false);
    }
  };

  if (loading) return <div className="p-8 text-center animate-pulse">Loading transaction form...</div>;

  if (!wallet) return <div className="p-8 text-center">Wallet not found</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in pb-12">
        <button 
          onClick={() => navigate(-1)} 
          className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Wallet
        </button>

        <div className="flex items-center justify-between">
            <div>
                <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">Send Bitcoin</h1>
                <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 mt-1">From: {wallet.name}</p>
            </div>
            <div className="text-right">
                <div className="text-sm text-sanctuary-500">Available Balance</div>
                <Amount sats={wallet.balance} size="lg" className="font-medium text-sanctuary-900 dark:text-sanctuary-100 items-end" />
            </div>
        </div>

        {/* Existing Drafts Notification Banner */}
        {showDraftsBanner && existingDraftsCount > 0 && (
          <div className="bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-warning-600 dark:text-warning-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-warning-700 dark:text-warning-300">
                  You have {existingDraftsCount} draft transaction{existingDraftsCount > 1 ? 's' : ''} pending
                </p>
                <p className="text-xs text-warning-600 dark:text-warning-400">
                  Consider resuming an existing draft instead of creating a new one.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => navigate(`/wallets/${id}`, { state: { activeTab: 'drafts' } })}
                className="px-3 py-1.5 text-xs font-medium text-warning-700 dark:text-warning-300 bg-warning-100 dark:bg-warning-800/50 hover:bg-warning-200 dark:hover:bg-warning-700/50 rounded-lg transition-colors"
              >
                View Drafts
              </button>
              <button
                onClick={() => setShowDraftsBanner(false)}
                className="p-1 text-warning-500 hover:text-warning-700 dark:hover:text-warning-300 transition-colors"
                title="Dismiss"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Draft Resume Banner */}
        {currentDraftId && (
          <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700 rounded-xl p-4 flex items-center gap-3">
            <Save className="w-5 h-5 text-primary-600 dark:text-primary-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-primary-700 dark:text-primary-300">
                Resuming Draft Transaction
              </p>
              <p className="text-xs text-primary-600 dark:text-primary-400">
                {signedDevices.size > 0
                  ? `${signedDevices.size} signature(s) collected. Continue signing to complete the transaction.`
                  : 'Complete signing and broadcast, or update the draft to save your changes.'}
              </p>
            </div>
          </div>
        )}

        {/* Recipient & Amount */}
        <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 space-y-6">
            {/* Transaction Type Toggle */}
            <div className="flex items-center space-x-4">
              <button
                onClick={() => {
                  setIsConsolidation(false);
                  setRecipient('');
                }}
                disabled={isResumingDraft}
                className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                  !isConsolidation
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
                    : 'border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-500 hover:border-sanctuary-400'
                } ${isResumingDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
                title={isResumingDraft ? 'Cannot change transaction type when resuming draft' : ''}
              >
                <ArrowLeft className="w-4 h-4 inline mr-2 rotate-180" />
                External Send
              </button>
              <button
                onClick={() => {
                  setIsConsolidation(true);
                  setRecipient(consolidationAddress);
                }}
                disabled={walletAddresses.length === 0 || isResumingDraft}
                className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                  isConsolidation
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
                    : 'border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-500 hover:border-sanctuary-400 disabled:opacity-50 disabled:cursor-not-allowed'
                } ${isResumingDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
                title={isResumingDraft ? 'Cannot change transaction type when resuming draft' : walletAddresses.length === 0 ? 'No addresses available for consolidation' : 'Consolidate UTXOs to your own address'}
              >
                <RefreshCw className="w-4 h-4 inline mr-2" />
                Consolidation
              </button>
            </div>

            {isConsolidation && (
              <div className="p-4 bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 rounded-xl">
                <div className="flex items-start space-x-3">
                  <RefreshCw className="w-5 h-5 text-primary-600 dark:text-primary-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-primary-800 dark:text-primary-200">UTXO Consolidation</p>
                    <p className="text-xs text-primary-600 dark:text-primary-300 mt-1">
                      Combine multiple UTXOs into a single output. Useful for reducing future transaction fees and improving wallet privacy.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Coin Control Panel */}
            <CoinControlPanel
              walletId={id!}
              utxos={utxos}
              selectedUtxos={selectedUTXOs}
              onToggleSelect={toggleUTXO}
              onSetSelectedUtxos={setSelectedUTXOs}
              feeRate={feeRate}
              targetAmount={outputs.reduce((sum, o) => sum + (parseInt(o.amount) || 0), 0)}
              strategy={coinControlStrategy}
              onStrategyChange={setCoinControlStrategy}
              disabled={isResumingDraft}
            />

            {/* Privacy Warnings */}
            {privacyWarnings.length > 0 && !isResumingDraft && (
              <PrivacyWarnings
                warnings={privacyWarnings}
                dismissedWarnings={dismissedWarnings}
                onDismiss={(type) => setDismissedWarnings(prev => new Set([...prev, type]))}
              />
            )}

            {/* Outputs Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                  {isConsolidation ? 'Consolidation Output' : outputs.length > 1 ? `Outputs (${outputs.length})` : 'Output'}
                  {isResumingDraft && (
                    <span className="ml-2 text-xs text-sanctuary-500">(locked - resuming draft)</span>
                  )}
                </label>
                {!isConsolidation && !isResumingDraft && (
                  <button
                    type="button"
                    onClick={addOutput}
                    className="flex items-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Output
                  </button>
                )}
              </div>

              {outputs.map((output, index) => (
                <div key={index} className={`space-y-2 ${outputs.length > 1 ? 'p-3 rounded-lg surface-secondary border border-sanctuary-200 dark:border-sanctuary-700' : ''}`}>
                  {outputs.length > 1 && (
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-sanctuary-500">Output #{index + 1}</span>
                      {!isResumingDraft && (
                        <button
                          type="button"
                          onClick={() => removeOutput(index)}
                          className="text-sanctuary-400 hover:text-rose-500 transition-colors"
                          title="Remove output"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Address Input */}
                  {isConsolidation && index === 0 ? (
                    <div className="relative">
                      <select
                        value={output.address}
                        onChange={(e) => updateOutput(index, 'address', e.target.value)}
                        disabled={isResumingDraft}
                        className={`block w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors appearance-none pr-10 font-mono text-sm ${isResumingDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {walletAddresses.map((addr, idx) => (
                          <option key={addr} value={addr}>
                            #{idx}: {addr.slice(0, 12)}...{addr.slice(-8)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-3.5 w-5 h-5 text-sanctuary-400 pointer-events-none" />
                    </div>
                  ) : (
                    <div className="flex space-x-2">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={output.address}
                          onChange={(e) => handleAddressInput(index, e.target.value)}
                          disabled={isResumingDraft}
                          placeholder="bc1q... or bitcoin:..."
                          className={`block w-full px-4 py-2.5 rounded-xl border ${
                            outputsValid[index] === true
                              ? 'border-green-500 dark:border-green-400'
                              : outputsValid[index] === false
                              ? 'border-rose-500 dark:border-rose-400'
                              : payjoinUrl && index === 0
                              ? 'border-zen-indigo dark:border-zen-indigo'
                              : 'border-sanctuary-300 dark:border-sanctuary-700'
                          } surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors text-sm ${isResumingDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
                        />
                        {payjoinUrl && index === 0 ? (
                          <Shield className="absolute right-4 top-3 w-4 h-4 text-zen-indigo" />
                        ) : outputsValid[index] === true ? (
                          <Check className="absolute right-4 top-3 w-4 h-4 text-green-500" />
                        ) : outputsValid[index] === false ? (
                          <X className="absolute right-4 top-3 w-4 h-4 text-rose-500" />
                        ) : null}
                      </div>
                      {!isResumingDraft && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (showScanner && scanningOutputIndex === index) {
                              setShowScanner(false);
                              setScanningOutputIndex(null);
                              stopCamera();
                            } else {
                              setScanningOutputIndex(index);
                              startCamera();
                            }
                          }}
                        >
                          {showScanner && scanningOutputIndex === index ? <X className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
                        </Button>
                      )}
                    </div>
                  )}
                  {!isConsolidation && outputsValid[index] === false && (
                    <p className="text-xs text-rose-500">Invalid Bitcoin address</p>
                  )}
                  {payjoinUrl && index === 0 && (
                    <div className="flex items-center space-x-1.5 mt-1">
                      <Shield className="w-3 h-3 text-zen-indigo" />
                      <p className="text-xs text-zen-indigo">
                        Payjoin enabled - enhanced privacy for this transaction
                        {payjoinStatus === 'attempting' && ' (attempting...)'}
                        {payjoinStatus === 'success' && ' ✓'}
                        {payjoinStatus === 'failed' && ' (fell back to regular send)'}
                      </p>
                    </div>
                  )}

                  {/* QR Scanner for this output */}
                  {showScanner && scanningOutputIndex === index && (
                    <div className="relative overflow-hidden rounded-xl bg-black aspect-video flex items-center justify-center">
                      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
                      <canvas ref={canvasRef} className="hidden" />
                      <div className="z-10 border-2 border-white/50 w-48 h-48 rounded-lg"></div>
                      <p className="absolute bottom-4 z-10 text-white bg-black/50 px-3 py-1 rounded-full text-xs">Scan Bitcoin QR Code</p>
                    </div>
                  )}

                  {/* Amount Input */}
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        inputMode={unit === 'btc' ? 'decimal' : 'numeric'}
                        value={output.sendMax ? satsToDisplay(calculateMaxForOutput(index)) : (output.displayValue ?? satsToDisplay(output.amount))}
                        onChange={(e) => {
                          const value = e.target.value;
                          // Allow empty, digits, and decimal point for BTC mode
                          const isValidBtc = value === '' || /^[0-9]*\.?[0-9]*$/.test(value);
                          const isValidSats = value === '' || /^[0-9]*$/.test(value);

                          if ((unit === 'btc' && isValidBtc) || (unit !== 'btc' && isValidSats)) {
                            setOutputs(prev => {
                              const newOutputs = [...prev];
                              newOutputs[index] = {
                                ...newOutputs[index],
                                displayValue: value,
                                amount: displayToSats(value),
                                sendMax: false,
                              };
                              return newOutputs;
                            });
                          }
                        }}
                        onBlur={() => {
                          // On blur, clear displayValue to use canonical sats display
                          setOutputs(prev => {
                            const newOutputs = [...prev];
                            newOutputs[index] = { ...newOutputs[index], displayValue: undefined };
                            return newOutputs;
                          });
                        }}
                        placeholder="0"
                        readOnly={output.sendMax || isResumingDraft}
                        disabled={isResumingDraft}
                        className={`block w-full px-4 py-2.5 pr-20 rounded-xl border text-sm ${
                          output.sendMax
                            ? 'border-primary-400 dark:border-primary-500 bg-primary-50/50 dark:bg-primary-900/10'
                            : 'border-sanctuary-300 dark:border-sanctuary-700'
                        } surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors ${isResumingDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
                      />
                      <div className="absolute right-3 top-2.5 text-sanctuary-400 text-xs flex items-center">
                        {output.sendMax && !isResumingDraft && (
                          <button
                            type="button"
                            onClick={() => updateOutput(index, 'sendMax', false)}
                            className="mr-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors"
                            title="Click to exit MAX mode"
                          >
                            MAX
                          </button>
                        )}
                        <span className="pointer-events-none">{unitLabel}</span>
                      </div>
                    </div>
                    {!isResumingDraft && (
                      <button
                        type="button"
                        onClick={() => {
                          toggleSendMax(index);
                          // Only select all UTXOs if none are currently selected
                          // If user has already selected specific UTXOs, respect that selection
                          if (!output.sendMax && selectedUTXOs.size === 0 && spendableUtxos.length > 0) {
                            const allSpendable = new Set(spendableUtxos.map(u => `${u.txid}:${u.vout}`));
                            setSelectedUTXOs(allSpendable);
                            setShowCoinControl(true);
                          }
                        }}
                        className={`px-3 py-2.5 text-xs font-medium rounded-xl border transition-colors ${
                          output.sendMax
                            ? 'bg-primary-500 text-white border-primary-500 hover:bg-primary-600'
                            : 'border-sanctuary-300 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
                        }`}
                      >
                        MAX
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex justify-between text-xs text-sanctuary-500 mt-2">
                {showCoinControl ? (
                  <span>Selected: {format(selectedTotal)} ({selectedUTXOs.size} UTXO{selectedUTXOs.size !== 1 ? 's' : ''})</span>
                ) : (
                  <span>Available: {format(spendableUtxos.reduce((sum, u) => sum + u.amount, 0))} ({spendableUtxos.length} UTXO{spendableUtxos.length !== 1 ? 's' : ''})</span>
                )}
                <span>Max sendable: {format(maxSendableAmount)}</span>
              </div>
            </div>

            {/* Advanced Options */}
            <div className="border-t border-sanctuary-200 dark:border-sanctuary-800 pt-4">
              <button
                type="button"
                onClick={() => !isResumingDraft && setShowAdvanced(!showAdvanced)}
                disabled={isResumingDraft}
                className={`flex items-center text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200 transition-colors ${isResumingDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <Sliders className="w-4 h-4 mr-2" />
                Advanced Options
                <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-3 pl-6">
                  <label className={`flex items-center space-x-3 ${isResumingDraft ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={enableRBF}
                      onChange={(e) => !isResumingDraft && setEnableRBF(e.target.checked)}
                      disabled={isResumingDraft}
                      className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
                    />
                    <div>
                      <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable RBF</span>
                      <p className="text-xs text-sanctuary-500">Replace-by-Fee allows you to bump the fee later if the transaction is stuck</p>
                    </div>
                  </label>

                  <label className={`flex items-center space-x-3 ${isResumingDraft ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={subtractFeesFromAmount}
                      onChange={(e) => !isResumingDraft && setSubtractFeesFromAmount(e.target.checked)}
                      disabled={isResumingDraft}
                      className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
                    />
                    <div>
                      <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Subtract fees from amount</span>
                      <p className="text-xs text-sanctuary-500">Deduct network fees from the amount sent instead of adding to total</p>
                    </div>
                  </label>

                  <div className={`space-y-2 ${isResumingDraft ? 'opacity-60' : ''}`}>
                    <label className={`flex items-center space-x-3 ${isResumingDraft ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={enableDecoyOutputs}
                        onChange={(e) => !isResumingDraft && setEnableDecoyOutputs(e.target.checked)}
                        disabled={isResumingDraft}
                        className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
                      />
                      <div>
                        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Stonewall-like Decoy Outputs</span>
                        <p className="text-xs text-sanctuary-500">Split change into multiple outputs to confuse chain analysis</p>
                      </div>
                    </label>
                    {enableDecoyOutputs && (
                      <div className="ml-7 flex items-center gap-2">
                        <span className="text-xs text-sanctuary-500">Number of outputs:</span>
                        <select
                          value={decoyCount}
                          onChange={(e) => setDecoyCount(Number(e.target.value))}
                          disabled={isResumingDraft}
                          className="text-sm px-2 py-1 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 surface-secondary text-sanctuary-900 dark:text-sanctuary-100"
                        >
                          <option value={2}>2 outputs</option>
                          <option value={3}>3 outputs</option>
                          <option value={4}>4 outputs</option>
                        </select>
                        <span className="text-xs text-amber-600 dark:text-amber-400">+~{(decoyCount - 1) * 34} vBytes</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
        </div>

        {/* Fee Selection */}
        <div className={`space-y-4 ${isResumingDraft ? 'opacity-60' : ''}`}>
             <div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">Network Fee</h3>
                <p className="text-sm text-sanctuary-500 mb-4">
                  {isResumingDraft ? 'Fee rate is locked for draft transactions.' : 'Click a block below to target its confirmation speed, or select a preset.'}
                </p>
                <div className={`surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-2 mb-4 overflow-hidden ${isResumingDraft ? 'pointer-events-none' : ''}`}>
                    <BlockVisualizer
                      blocks={mempoolBlocks}
                      queuedBlocksSummary={queuedBlocksSummary}
                      onBlockClick={isResumingDraft ? undefined : (rate) => setFeeRate(rate)}
                      compact={true}
                    />
                </div>
             </div>

             <div className="surface-elevated p-3 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
                <div className="flex flex-wrap items-center gap-2">
                    {[
                        { label: 'High Priority', rate: fees?.fastestFee, time: '~10m' },
                        { label: 'Standard', rate: fees?.halfHourFee, time: '~30m' },
                        { label: 'Economy', rate: fees?.hourFee, time: '~1hr' },
                    ].map((opt) => (
                        <button
                           key={opt.label}
                           onClick={() => !isResumingDraft && setFeeRate(opt.rate || 1)}
                           className={`px-3 py-2 rounded-lg border transition-all text-left ${feeRate === opt.rate ? 'border-sanctuary-800 dark:border-sanctuary-200 bg-sanctuary-100 dark:bg-sanctuary-800' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'} ${isResumingDraft ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                        >
                            <div className="text-xs text-sanctuary-500">{opt.label}</div>
                            <div className="text-sm font-semibold">{opt.rate} <span className="text-[10px] font-normal text-sanctuary-400">sat/vB</span></div>
                        </button>
                    ))}
                    <div className="flex items-center gap-2 ml-auto">
                        <label className="text-xs text-sanctuary-500">Custom:</label>
                        <input
                           type="number"
                           min={0.1}
                           step={0.01}
                           value={feeRate}
                           onChange={(e) => !isResumingDraft && setFeeRate(parseFloat(e.target.value) || 0)}
                           disabled={isResumingDraft}
                           className={`w-20 px-2 py-1.5 text-sm rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 bg-transparent focus:ring-2 focus:ring-sanctuary-500 ${isResumingDraft ? 'cursor-not-allowed' : ''}`}
                        />
                        <span className="text-xs text-sanctuary-400">sat/vB</span>
                    </div>
                </div>
             </div>
        </div>

        {/* Transaction Flow Preview */}
        {showFlowPreview && (
          <TransactionFlowPreview
            inputs={flowPreviewData.inputs}
            outputs={flowPreviewData.outputs}
            fee={flowPreviewData.fee}
            feeRate={feeRate}
            totalInput={flowPreviewData.totalInput}
            totalOutput={flowPreviewData.totalOutput}
            isEstimate={!unsignedPsbt}
          />
        )}

        {/* Error Display */}
        {error && (
          <div className="flex items-center p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-800 dark:text-rose-200 rounded-xl">
            <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Multisig Signing Panel */}
        {(wallet?.type === WalletType.MULTI_SIG || wallet?.type === 'multi_sig') && walletDevices.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-2xl border border-blue-200 dark:border-blue-500/20">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    Multisig Signing
                  </h3>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    {typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m} of {typeof wallet.quorum === 'number' ? wallet.totalSigners : wallet.quorum?.n} signatures required
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`text-sm font-medium ${
                  signedDevices.size >= (typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m || 1)
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-sanctuary-500'
                }`}>
                  {signedDevices.size} / {typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m} collected
                </span>
              </div>
            </div>

            {/* Device List */}
            <div className="space-y-3">
              {walletDevices.map((device, index) => {
                const hasSigned = signedDevices.has(device.id);
                const isSigning = signingDeviceId === device.id;
                const isExpanded = expandedDeviceId === device.id;
                const isConnected = hardwareWallet.device?.fingerprint === device.fingerprint;
                const capabilities = getDeviceCapabilities(device.type);

                // Handle signing with a specific connection method
                const handleSign = async (method: ConnectionMethod) => {
                  setExpandedDeviceId(null);

                  if (method === 'airgap') {
                    // Show PSBT download/upload options
                    setPsbtDeviceId(psbtDeviceId === device.id ? null : device.id);
                    return;
                  }

                  setSigningDeviceId(device.id);
                  try {
                    // USB or Bluetooth connection
                    await hardwareWallet.connect(device.type.toLowerCase().includes('ledger') ? 'ledger' :
                                                 device.type.toLowerCase().includes('trezor') ? 'trezor' :
                                                 device.type.toLowerCase().includes('coldcard') ? 'coldcard' :
                                                 device.type.toLowerCase().includes('bitbox') ? 'bitbox' :
                                                 device.type.toLowerCase().includes('jade') ? 'jade' : 'ledger');
                    // After successful connection, mark as signed (in real implementation, would sign PSBT)
                    setSignedDevices(prev => new Set([...prev, device.id]));
                  } catch (err) {
                    log.error('Signing failed', { error: err });
                    setError(err instanceof Error ? err.message : 'Signing failed');
                  } finally {
                    setSigningDeviceId(null);
                  }
                };

                // Handle PSBT download
                const handleDownloadPsbt = async () => {
                  try {
                    if (!id || !recipient || !amount) {
                      setError('Please enter recipient and amount first');
                      return;
                    }

                    const amountSats = parseInt(amount);

                    // Create actual PSBT via backend API
                    const txData = await transactionsApi.createTransaction(id, {
                      recipient,
                      amount: amountSats,
                      feeRate,
                      selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
                      enableRBF,
                      sendMax: isSendMax,
                      subtractFees: subtractFeesFromAmount,
                      decoyOutputs: enableDecoyOutputs ? { enabled: true, count: decoyCount } : undefined,
                    });

                    // Download the base64 PSBT
                    const blob = new Blob([txData.psbtBase64], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${wallet?.name || 'transaction'}_unsigned.psbt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    setUnsignedPsbt(txData.psbtBase64);
                  } catch (err) {
                    log.error('Failed to download PSBT', { error: err });
                    if (err instanceof ApiError) {
                      setError(err.message);
                    } else {
                      setError('Failed to create PSBT file');
                    }
                  }
                };

                // Handle PSBT upload
                const handleUploadPsbt = (event: React.ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0];
                  if (!file) return;

                  const reader = new FileReader();
                  reader.onload = (e) => {
                    const content = e.target?.result as string;
                    // In production, validate the signed PSBT
                    log.debug('Uploaded signed PSBT', { preview: content.substring(0, 50) + '...' });
                    // Mark device as signed
                    setSignedDevices(prev => new Set([...prev, device.id]));
                    setPsbtDeviceId(null);
                  };
                  reader.readAsText(file);
                };

                const showPsbtPanel = psbtDeviceId === device.id;

                return (
                  <div
                    key={device.id}
                    className={`rounded-xl border transition-all ${
                      hasSigned
                        ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20'
                        : isSigning
                        ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/30'
                        : 'surface-muted border-sanctuary-200 dark:border-sanctuary-800'
                    }`}
                  >
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          hasSigned
                            ? 'bg-green-100 dark:bg-green-500/20'
                            : 'bg-sanctuary-200 dark:bg-sanctuary-800'
                        }`}>
                          {hasSigned ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                          ) : (
                            getDeviceIcon(device.type, "w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400")
                          )}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${
                            hasSigned
                              ? 'text-green-900 dark:text-green-100'
                              : 'text-sanctuary-900 dark:text-sanctuary-100'
                          }`}>
                            {device.label}
                          </p>
                          <p className="text-xs text-sanctuary-500">
                            {device.type} • <span className="font-mono">{device.fingerprint}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {hasSigned ? (
                          <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-500/20 rounded-lg">
                            <Check className="w-3 h-3 mr-1" />
                            Signed
                          </span>
                        ) : isSigning ? (
                          <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-500/20 rounded-lg">
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Signing...
                          </span>
                        ) : capabilities.methods.length === 1 ? (
                          // Single method - show direct button
                          <button
                            onClick={() => handleSign(capabilities.methods[0])}
                            disabled={!canCreateTransaction()}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-sanctuary-300 dark:disabled:bg-sanctuary-700 disabled:text-sanctuary-500 dark:disabled:text-sanctuary-400 disabled:cursor-not-allowed rounded-lg transition-colors"
                          >
                            {React.createElement(getConnectionIcon(capabilities.methods[0]), { className: "w-3 h-3 mr-1.5" })}
                            Sign via {capabilities.labels[capabilities.methods[0]]}
                          </button>
                        ) : (
                          // Multiple methods - show dropdown
                          <div className="relative">
                            <button
                              onClick={() => setExpandedDeviceId(isExpanded ? null : device.id)}
                              disabled={!canCreateTransaction()}
                              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-sanctuary-300 dark:disabled:bg-sanctuary-700 disabled:text-sanctuary-500 dark:disabled:text-sanctuary-400 disabled:cursor-not-allowed rounded-lg transition-colors"
                            >
                              <Shield className="w-3 h-3 mr-1.5" />
                              Sign
                              <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expanded connection options */}
                    {isExpanded && capabilities.methods.length > 1 && (
                      <div className="px-3 pb-3 pt-1 border-t border-sanctuary-200 dark:border-sanctuary-700 mt-1">
                        <p className="text-xs text-sanctuary-500 mb-2">Select connection method:</p>
                        <div className="flex flex-wrap gap-2">
                          {capabilities.methods.map(method => {
                            const Icon = getConnectionIcon(method);
                            return (
                              <button
                                key={method}
                                onClick={() => handleSign(method)}
                                className="inline-flex items-center px-3 py-2 text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-white dark:bg-sanctuary-800 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 border border-sanctuary-200 dark:border-sanctuary-600 rounded-lg transition-colors"
                              >
                                <Icon className="w-4 h-4 mr-2" />
                                {capabilities.labels[method]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* PSBT Download/Upload Panel */}
                    {showPsbtPanel && (
                      <div className="px-3 pb-3 pt-2 border-t border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/10 rounded-b-xl">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-3">Air-Gap Signing</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={handleDownloadPsbt}
                            disabled={!canCreateTransaction()}
                            className="inline-flex items-center px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-white dark:bg-sanctuary-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 border border-amber-300 dark:border-amber-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <FileDown className="w-4 h-4 mr-2" />
                            Download PSBT
                          </button>
                          <label className={`inline-flex items-center px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-white dark:bg-sanctuary-800 border border-amber-300 dark:border-amber-600 rounded-lg transition-colors ${
                            canCreateTransaction()
                              ? 'hover:bg-amber-100 dark:hover:bg-amber-900/30 cursor-pointer'
                              : 'opacity-50 cursor-not-allowed'
                          }`}>
                            <Upload className="w-4 h-4 mr-2" />
                            Upload Signed PSBT
                            <input
                              type="file"
                              accept=".psbt,.txt"
                              onChange={handleUploadPsbt}
                              className="hidden"
                              disabled={!canCreateTransaction()}
                            />
                          </label>
                        </div>
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                          Download the unsigned PSBT, sign it on your {device.type}, then upload the signed file.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Progress indicator */}
            <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-500/20">
              <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300 mb-2">
                <span>Signature Progress</span>
                <span>{Math.round((signedDevices.size / ((typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m) || 1)) * 100)}%</span>
              </div>
              <div className="h-2 bg-blue-200 dark:bg-blue-800/50 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    signedDevices.size >= ((typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m) || 1)
                      ? 'bg-green-500'
                      : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, (signedDevices.size / ((typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m) || 1)) * 100)}%` }}
                />
              </div>
            </div>

            {/* Info notice */}
            <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-800/30 rounded-lg">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                <Shield className="w-3 h-3 inline mr-1" />
                Each signer must verify the transaction details on their device before signing. Your private keys never leave the hardware wallet.
              </p>
            </div>
          </div>
        )}

        {/* Hardware Wallet Status (Single-sig only - multisig has inline signing) */}
        {wallet?.type !== WalletType.MULTI_SIG && wallet?.type !== 'multi_sig' && hardwareWallet.isConnected && hardwareWallet.device && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-500/10 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-green-900 dark:text-green-100">
                    {hardwareWallet.device.name} Connected
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Ready to sign transactions securely
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => hardwareWallet.disconnect()}
              >
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {/* Hardware Wallet Connect Button (Single-sig only - multisig has inline signing) */}
        {wallet?.type !== WalletType.MULTI_SIG && wallet?.type !== 'multi_sig' && !hardwareWallet.isConnected && (() => {
          // Get the device for this single-sig wallet
          const singleSigDevice = walletDevices.length > 0 ? walletDevices[0] : null;
          const capabilities = singleSigDevice ? getDeviceCapabilities(singleSigDevice.type) : null;
          const showSingleSigPsbt = showPsbtOptions;

          // Handle PSBT for single-sig
          const handleSingleSigDownloadPsbt = async () => {
            try {
              if (!id || !recipient || !amount) {
                setError('Please enter recipient and amount first');
                return;
              }

              const amountSats = parseInt(amount);

              // Create actual PSBT via backend API
              const txData = await transactionsApi.createTransaction(id, {
                recipient,
                amount: amountSats,
                feeRate,
                selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
                enableRBF,
                sendMax: isSendMax,
                subtractFees: subtractFeesFromAmount,
                decoyOutputs: enableDecoyOutputs ? { enabled: true, count: decoyCount } : undefined,
              });

              // Download the base64 PSBT
              const blob = new Blob([txData.psbtBase64], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${wallet?.name || 'transaction'}_unsigned.psbt`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              setUnsignedPsbt(txData.psbtBase64);
            } catch (err) {
              log.error('Failed to download PSBT', { error: err });
              if (err instanceof ApiError) {
                setError(err.message);
              } else {
                setError('Failed to create PSBT file');
              }
            }
          };

          const handleSingleSigUploadPsbt = (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
              const content = e.target?.result as string;
              log.debug('Uploaded signed PSBT', { preview: content.substring(0, 50) + '...' });
              // In production, this would broadcast the signed transaction
              showSuccess('Signed PSBT uploaded! Ready to broadcast.', 'PSBT Uploaded');
              setShowPsbtOptions(false);
            };
            reader.readAsText(file);
          };

          return (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-500/20 rounded-xl overflow-hidden">
              <div className="p-4">
                <div className="flex items-start space-x-3">
                  {singleSigDevice ? (
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      {getDeviceIcon(singleSigDevice.type, "w-5 h-5 text-blue-600 dark:text-blue-400")}
                    </div>
                  ) : (
                    <Usb className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                      {singleSigDevice ? `Sign with ${singleSigDevice.label}` : 'Hardware Wallet Recommended'}
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                      {singleSigDevice
                        ? `${singleSigDevice.type} • ${singleSigDevice.fingerprint}`
                        : 'Connect your hardware wallet to sign transactions securely. Your keys never leave the device.'}
                    </p>

                    {singleSigDevice && capabilities ? (
                      // Device found - show connection options based on capabilities
                      <div className="flex flex-wrap gap-2">
                        {capabilities.methods.map(method => {
                          const Icon = getConnectionIcon(method);
                          return (
                            <Button
                              key={method}
                              variant="secondary"
                              size="sm"
                              disabled={!canCreateTransaction()}
                              onClick={async () => {
                                if (method === 'airgap') {
                                  setShowPsbtOptions(!showPsbtOptions);
                                } else {
                                  try {
                                    const deviceType = singleSigDevice?.type.toLowerCase();
                                    await hardwareWallet.connect(
                                      deviceType?.includes('ledger') ? 'ledger' :
                                      deviceType?.includes('trezor') ? 'trezor' :
                                      deviceType?.includes('coldcard') ? 'coldcard' :
                                      deviceType?.includes('bitbox') ? 'bitbox' :
                                      deviceType?.includes('jade') ? 'jade' : 'ledger'
                                    );
                                  } catch (err) {
                                    log.error('Connection failed', { error: err });
                                  }
                                }
                              }}
                            >
                              <Icon className="w-4 h-4 mr-2" />
                              {capabilities.labels[method]}
                            </Button>
                          );
                        })}
                      </div>
                    ) : (
                      // No device associated - show generic connect button
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canCreateTransaction()}
                        onClick={() => setShowHWConnect(true)}
                      >
                        <Shield className="w-4 h-4 mr-2" />
                        Connect Hardware Wallet
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* PSBT Panel for single-sig */}
              {showSingleSigPsbt && (
                <div className="px-4 pb-4 pt-2 border-t border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/10">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-3">Air-Gap Signing</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleSingleSigDownloadPsbt}
                      disabled={!canCreateTransaction()}
                      className="inline-flex items-center px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-white dark:bg-sanctuary-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 border border-amber-300 dark:border-amber-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      Download PSBT
                    </button>
                    <label className={`inline-flex items-center px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-white dark:bg-sanctuary-800 border border-amber-300 dark:border-amber-600 rounded-lg transition-colors ${
                      canCreateTransaction()
                        ? 'hover:bg-amber-100 dark:hover:bg-amber-900/30 cursor-pointer'
                        : 'opacity-50 cursor-not-allowed'
                    }`}>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Signed PSBT
                      <input
                        type="file"
                        accept=".psbt,.txt"
                        onChange={handleSingleSigUploadPsbt}
                        className="hidden"
                        disabled={!canCreateTransaction()}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    Download the unsigned PSBT, sign it on your {singleSigDevice?.type}, then upload the signed file.
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 p-4 surface-elevated border-t border-sanctuary-200 dark:border-sanctuary-800 md:static md:bg-transparent md:border-0 md:p-0">
             {/* For single-sig, require hardware wallet connection OR signed PSBT to broadcast */}
             {(() => {
               const isSingleSig = wallet?.type !== WalletType.MULTI_SIG && wallet?.type !== 'multi_sig';
               const canBroadcast = hardwareWallet.isConnected || (isSingleSig && unsignedPsbt && signedDevices.size > 0);

               // Get device capabilities for single-sig wallet
               const singleSigDevice = walletDevices.length > 0 ? walletDevices[0] : null;
               const deviceCapabilities = singleSigDevice ? getDeviceCapabilities(singleSigDevice.type) : null;
               const supportsUsb = deviceCapabilities?.methods.includes('usb') ?? false;
               const supportsAirgap = deviceCapabilities?.methods.includes('airgap') ?? false;

               // Single-sig without connection or signed PSBT - show signing options
               if (isSingleSig && !canBroadcast) {
                 // Determine device type for direct connection
                 const getDeviceType = (deviceLabel: string | undefined): 'ledger' | 'trezor' | 'coldcard' | 'bitbox' | 'jade' | 'unknown' => {
                   if (!deviceLabel) return 'unknown';
                   const lower = deviceLabel.toLowerCase();
                   if (lower.includes('ledger')) return 'ledger';
                   if (lower.includes('trezor')) return 'trezor';
                   if (lower.includes('coldcard')) return 'coldcard';
                   if (lower.includes('bitbox')) return 'bitbox';
                   if (lower.includes('jade')) return 'jade';
                   return 'unknown';
                 };

                 const knownDeviceType = getDeviceType(singleSigDevice?.type || singleSigDevice?.label);

                 // Direct USB connection handler - skips device picker if we know the device type
                 const handleDirectUsbConnect = async () => {
                   if (knownDeviceType !== 'unknown') {
                     try {
                       await hardwareWallet.connect(knownDeviceType);
                     } catch (err) {
                       log.error('Hardware wallet connection failed', { error: err });
                       setError(err instanceof Error ? err.message : 'Failed to connect hardware wallet');
                     }
                   } else {
                     // Fallback to device picker if type is unknown
                     setShowHWConnect(true);
                   }
                 };

                 return (
                   <div className="space-y-2">
                     {/* USB connection option - only if device supports USB */}
                     {supportsUsb && (
                       <Button
                         size="lg"
                         className="w-full shadow-lg shadow-sanctuary-900/10 dark:shadow-black/20"
                         disabled={!allOutputsHaveAddress || hasInvalidAddress || hardwareWallet.connecting}
                         onClick={handleDirectUsbConnect}
                       >
                         {hardwareWallet.connecting ? (
                           <>
                             <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                             Connecting...
                           </>
                         ) : (
                           <>
                             <Usb className="w-5 h-5 mr-2" />
                             Connect {singleSigDevice?.label || 'Hardware Wallet'} via USB
                           </>
                         )}
                       </Button>
                     )}

                     {/* Show "or" divider if both options available */}
                     {supportsUsb && supportsAirgap && (
                       <div className="flex items-center justify-center text-xs text-sanctuary-500">
                         <span className="px-2">or</span>
                       </div>
                     )}

                     {/* PSBT/Air-gap option - only if device supports it */}
                     {supportsAirgap && (
                       <>
                         <Button
                           size="lg"
                           variant={supportsUsb ? "secondary" : "primary"}
                           className="w-full"
                           disabled={!allOutputsHaveAddress || hasInvalidAddress}
                           onClick={async () => {
                             // Create PSBT for download
                             if (!id || !outputs[0]?.address) return;
                             try {
                               const apiOutputs = outputs.map(o => ({
                                 address: o.address,
                                 amount: o.sendMax ? 0 : parseInt(o.amount || '0'),
                                 sendMax: o.sendMax,
                               }));
                               let txData: any;
                               if (outputs.length > 1 || outputs.some(o => o.sendMax)) {
                                 txData = await transactionsApi.createBatchTransaction(id, {
                                   outputs: apiOutputs,
                                   feeRate,
                                   selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
                                   enableRBF,
                                 });
                               } else {
                                 txData = await transactionsApi.createTransaction(id, {
                                   recipient: outputs[0].address,
                                   amount: parseInt(outputs[0].amount || '0'),
                                   feeRate,
                                   selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
                                   enableRBF,
                                   sendMax: outputs[0].sendMax || false,
                                   subtractFees: subtractFeesFromAmount,
                                   decoyOutputs: enableDecoyOutputs ? { enabled: true, count: decoyCount } : undefined,
                                 });
                               }
                               // Download PSBT
                               const blob = new Blob([txData.psbtBase64], { type: 'text/plain' });
                               const url = URL.createObjectURL(blob);
                               const a = document.createElement('a');
                               a.href = url;
                               a.download = `${wallet?.name || 'transaction'}_unsigned.psbt`;
                               document.body.appendChild(a);
                               a.click();
                               document.body.removeChild(a);
                               URL.revokeObjectURL(url);
                               setUnsignedPsbt(txData.psbtBase64);
                               showSuccess(`PSBT downloaded. Sign it with ${singleSigDevice?.label || 'your device'} and upload the signed file.`, 'PSBT Ready');
                             } catch (err) {
                               log.error('Failed to create PSBT', { error: err });
                               setError(err instanceof Error ? err.message : 'Failed to create PSBT');
                             }
                           }}
                         >
                           <FileDown className="w-5 h-5 mr-2" />
                           {deviceCapabilities?.labels.airgap || 'Download PSBT'} for Signing
                         </Button>
                         {unsignedPsbt && (
                           <label className="flex items-center justify-center w-full py-2.5 px-4 text-sm font-medium text-sanctuary-600 dark:text-sanctuary-300 bg-sanctuary-100 dark:bg-sanctuary-800 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-xl cursor-pointer transition-colors">
                             <Upload className="w-4 h-4 mr-2" />
                             Upload Signed PSBT
                             <input
                               type="file"
                               accept=".psbt,.txt"
                               className="hidden"
                               onChange={(e) => {
                                 const file = e.target.files?.[0];
                                 if (!file) return;
                                 const reader = new FileReader();
                                 reader.onload = (ev) => {
                                   const content = ev.target?.result as string;
                                   setUnsignedPsbt(content.trim());
                                   setSignedDevices(new Set(['psbt-signed']));
                                   showSuccess('Signed PSBT uploaded. Ready to broadcast.', 'PSBT Uploaded');
                                 };
                                 reader.readAsText(file);
                               }}
                             />
                           </label>
                         )}
                       </>
                     )}

                     {/* Fallback if no device or unknown capabilities */}
                     {!singleSigDevice && (
                       <Button
                         size="lg"
                         className="w-full shadow-lg shadow-sanctuary-900/10 dark:shadow-black/20"
                         disabled={!allOutputsHaveAddress || hasInvalidAddress}
                         onClick={() => setShowHWConnect(true)}
                       >
                         <Usb className="w-5 h-5 mr-2" />
                         Connect Hardware Wallet to Sign
                       </Button>
                     )}
                   </div>
                 );
               }

               return (
                 <Button
                   size="lg"
                   className="w-full shadow-lg shadow-sanctuary-900/10 dark:shadow-black/20"
                   disabled={!allOutputsHaveAddress || hasInvalidAddress || broadcasting || hardwareWallet.signing}
                   onClick={handleBroadcast}
                 >
                   {broadcasting || hardwareWallet.signing ? (
                     <>
                       <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                       {hardwareWallet.signing ? 'Signing with Device...' : 'Broadcasting...'}
                     </>
                   ) : (wallet?.type === WalletType.MULTI_SIG || wallet?.type === 'multi_sig') ? (
                     hardwareWallet.isConnected ? (
                       <>
                         <Shield className="w-5 h-5 mr-2" />
                         Sign with {hardwareWallet.device?.name} ({signedDevices.size + 1}/{typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m})
                       </>
                     ) : (
                       <>
                         <Users className="w-5 h-5 mr-2" />
                         Collect Signatures ({signedDevices.size}/{typeof wallet.quorum === 'number' ? wallet.quorum : wallet.quorum?.m} of {typeof wallet.quorum === 'number' ? wallet.totalSigners : wallet.quorum?.n})
                       </>
                     )
                   ) : signedDevices.has('psbt-signed') ? (
                     <>
                       <Shield className="w-5 h-5 mr-2" />
                       Broadcast Signed Transaction
                     </>
                   ) : (
                     <>
                       <Shield className="w-5 h-5 mr-2" />
                       Sign & Broadcast with {hardwareWallet.device?.name}
                     </>
                   )}
                 </Button>
               );
             })()}

             {/* Save as Draft Button */}
             <button
               onClick={handleSaveAsDraft}
               disabled={!allOutputsHaveAddress || hasInvalidAddress || savingDraft}
               className="w-full mt-3 py-2 px-4 text-sm font-medium text-sanctuary-600 dark:text-sanctuary-300 bg-sanctuary-100 dark:bg-sanctuary-800 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
             >
               {savingDraft ? (
                 <>
                   <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                   Saving Draft...
                 </>
               ) : (
                 <>
                   <Save className="w-4 h-4 mr-2" />
                   {currentDraftId ? 'Update Draft' : 'Save as Draft'}
                 </>
               )}
             </button>

             <div className="mt-2 text-center text-xs text-sanctuary-400">
                 Estimated Fee: {format(calculateTotalFee(), { forceSats: true })}
             </div>

             {/* Fee Warning */}
             {feeWarning && (
               <div className={`mt-3 p-3 rounded-lg border ${
                 feeWarning.level === 'critical'
                   ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                   : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
               }`}>
                 <div className="flex items-center gap-2">
                   <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${
                     feeWarning.level === 'critical'
                       ? 'text-rose-500'
                       : 'text-amber-500'
                   }`} />
                   <div>
                     <p className={`text-sm font-medium ${
                       feeWarning.level === 'critical'
                         ? 'text-rose-700 dark:text-rose-300'
                         : 'text-amber-700 dark:text-amber-300'
                     }`}>
                       {feeWarning.message}
                     </p>
                     <p className={`text-xs mt-0.5 ${
                       feeWarning.level === 'critical'
                         ? 'text-rose-600 dark:text-rose-400'
                         : 'text-amber-600 dark:text-amber-400'
                     }`}>
                       Fee represents {feeWarning.percent.toFixed(1)}% of the send amount
                     </p>
                   </div>
                 </div>
               </div>
             )}
        </div>

        {/* Hardware Wallet Connect Modal */}
        <HardwareWalletConnect
          isOpen={showHWConnect}
          onClose={() => setShowHWConnect(false)}
          onConnect={handleHWConnect}
          connecting={hardwareWallet.connecting}
          error={hardwareWallet.error}
          isSupported={hardwareWallet.isSupported}
        />
    </div>
  );
};