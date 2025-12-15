import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Wallet, UTXO, FeeEstimate, WalletType, Device } from '../types';
import * as walletsApi from '../src/api/wallets';
import * as transactionsApi from '../src/api/transactions';
import * as bitcoinApi from '../src/api/bitcoin';
import * as devicesApi from '../src/api/devices';
import * as draftsApi from '../src/api/drafts';
import type { DraftTransaction } from '../src/api/drafts';
import { ApiError } from '../src/api/client';
import { Button } from './ui/Button';
import { BlockVisualizer } from './BlockVisualizer';
import type { BlockData, QueuedBlocksSummary } from '../src/api/bitcoin';
import { HardwareWalletConnect } from './HardwareWalletConnect';
import { useHardwareWallet } from '../hooks/useHardwareWallet';
import { ArrowLeft, Camera, Check, X, QrCode, Sliders, AlertTriangle, Loader2, Shield, Usb, RefreshCw, ChevronDown, Users, Key, Circle, CheckCircle2, Bluetooth, FileDown, Upload, Save, FileText, XCircle } from 'lucide-react';
import { HardwareDevice } from '../types';
import { getDeviceIcon } from './ui/CustomIcons';
import { useCurrency } from '../contexts/CurrencyContext';
import { useErrorHandler } from '../hooks/useErrorHandler';

// Device connection capabilities
type ConnectionMethod = 'usb' | 'bluetooth' | 'airgap';

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
      labels: { usb: 'USB', bluetooth: '', airgap: 'PSBT File' }
    };
  }

  // Ledger - USB and Bluetooth (Nano X, Stax, Flex)
  if (normalizedType.includes('ledger')) {
    if (normalizedType.includes('nano s') && !normalizedType.includes('plus')) {
      // Nano S only has USB
      return {
        methods: ['usb'],
        labels: { usb: 'USB', bluetooth: '', airgap: '' }
      };
    }
    return {
      methods: ['usb', 'bluetooth'],
      labels: { usb: 'USB', bluetooth: 'Bluetooth', airgap: '' }
    };
  }

  // Trezor - USB only
  if (normalizedType.includes('trezor')) {
    return {
      methods: ['usb'],
      labels: { usb: 'USB', bluetooth: '', airgap: '' }
    };
  }

  // BitBox02 - USB only
  if (normalizedType.includes('bitbox')) {
    return {
      methods: ['usb'],
      labels: { usb: 'USB', bluetooth: '', airgap: '' }
    };
  }

  // Foundation Passport - Air-gap only (QR codes, microSD)
  if (normalizedType.includes('passport') || normalizedType.includes('foundation')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', bluetooth: '', airgap: 'QR / SD Card' }
    };
  }

  // Blockstream Jade - USB and Bluetooth
  if (normalizedType.includes('jade') || normalizedType.includes('blockstream')) {
    return {
      methods: ['usb', 'bluetooth'],
      labels: { usb: 'USB', bluetooth: 'Bluetooth', airgap: '' }
    };
  }

  // Keystone - Air-gap only (QR codes)
  if (normalizedType.includes('keystone')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', bluetooth: '', airgap: 'QR Code' }
    };
  }

  // SeedSigner - Air-gap only (QR codes)
  if (normalizedType.includes('seedsigner')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', bluetooth: '', airgap: 'QR Code' }
    };
  }

  // Generic SD card device - Air-gap only
  if (normalizedType.includes('sd card') || normalizedType.includes('sd-card') || normalizedType.includes('airgap') || normalizedType.includes('air-gap')) {
    return {
      methods: ['airgap'],
      labels: { usb: '', bluetooth: '', airgap: 'PSBT File' }
    };
  }

  // Unknown device - default to USB + Air-gap options
  // This allows users to choose their preferred signing method
  return {
    methods: ['usb', 'airgap'],
    labels: { usb: 'USB', bluetooth: '', airgap: 'PSBT File' }
  };
};

const getConnectionIcon = (method: ConnectionMethod) => {
  switch (method) {
    case 'usb': return Usb;
    case 'bluetooth': return Bluetooth;
    case 'airgap': return FileDown;
  }
};
import { Amount } from './Amount';
import { useUser } from '../contexts/UserContext';
import jsQR from 'jsqr';

export const SendTransaction: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { format, getFiatValue, currencySymbol } = useCurrency();
  const { user } = useUser();
  const { handleError, showSuccess, showInfo } = useErrorHandler();

  // Hardware wallet integration
  const hardwareWallet = useHardwareWallet();
  const [showHWConnect, setShowHWConnect] = useState(false);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [utxos, setUTXOs] = useState<UTXO[]>([]);
  const [fees, setFees] = useState<FeeEstimate | null>(null);
  const [mempoolBlocks, setMempoolBlocks] = useState<BlockData[]>([]);
  const [queuedBlocksSummary, setQueuedBlocksSummary] = useState<QueuedBlocksSummary | null>(null);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState<number>(0);
  const [selectedUTXOs, setSelectedUTXOs] = useState<Set<string>>(new Set());
  const [showCoinControl, setShowCoinControl] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enableRBF, setEnableRBF] = useState(true);
  const [subtractFeesFromAmount, setSubtractFeesFromAmount] = useState(false);
  const [isSendMax, setIsSendMax] = useState(false);

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
  const [recipientValid, setRecipientValid] = useState<boolean | null>(null);

  // Draft transaction state
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [existingDraftsCount, setExistingDraftsCount] = useState(0);
  const [showDraftsBanner, setShowDraftsBanner] = useState(false);
  const [isResumingDraft, setIsResumingDraft] = useState(false);
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
        console.error('Failed to fetch wallet:', err);
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

        // Format UTXOs (include frozen status for coin control)
        const formattedUTXOs: UTXO[] = utxoData.utxos.map(utxo => ({
          id: utxo.id,
          txid: utxo.txid,
          vout: utxo.vout,
          amount: Number(utxo.amount),
          address: utxo.address,
          confirmations: utxo.confirmations,
          spendable: !utxo.spent,
          scriptType: formattedWallet.scriptType,
          frozen: utxo.frozen ?? false,
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
          console.error('Failed to fetch devices:', err);
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
          setRecipient(draftData.recipient);
          setAmount(draftData.amount.toString());
          setFeeRate(draftData.feeRate);
          setEnableRBF(draftData.enableRBF);
          setSubtractFeesFromAmount(draftData.subtractFees);
          setIsSendMax(draftData.sendMax);

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

          // Filter out frozen UTXOs from selected set when resuming
          if (draftData.selectedUtxoIds && draftData.selectedUtxoIds.length > 0) {
            // Filter out any UTXOs that are now frozen
            const validUtxoIds = draftData.selectedUtxoIds.filter(utxoId => !frozenUtxoIds.has(utxoId));

            // Warn if some UTXOs were removed due to frozen status
            const removedCount = draftData.selectedUtxoIds.length - validUtxoIds.length;
            if (removedCount > 0) {
              showInfo(`${removedCount} frozen UTXO${removedCount > 1 ? 's' : ''} removed from selection`);
            }

            setSelectedUTXOs(new Set(validUtxoIds));
            setShowCoinControl(true);
          }
          if (draftData.signedPsbtBase64) {
            setUnsignedPsbt(draftData.signedPsbtBase64);
          } else if (draftData.psbtBase64) {
            setUnsignedPsbt(draftData.psbtBase64);
          }
          if (draftData.signedDeviceIds && draftData.signedDeviceIds.length > 0) {
            setSignedDevices(new Set(draftData.signedDeviceIds));
          }
        }
      } catch (err) {
        console.error('Failed to fetch UTXOs or fees:', err);
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
          console.error('Failed to check for existing drafts:', err);
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
      console.error("Camera error", err);
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
             setRecipient(code.data);
             setShowScanner(false);
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

  const selectedTotal = utxos
    .filter(u => selectedUTXOs.has(`${u.txid}:${u.vout}`))
    .reduce((acc, u) => acc + u.amount, 0);

  const calculateTotalFee = () => {
      // Mock size calculation: (inputs * 148 + outputs * 34 + 10) * feeRate
      const inputs = selectedUTXOs.size || 1; // approximate if none selected yet
      const outputs = isSendMax ? 1 : 2; // No change output for sendMax
      const vbytes = (inputs * 148) + (outputs * 34) + 10;
      return vbytes * feeRate;
  }

  // Check if transaction can be created
  const canCreateTransaction = () => {
    if (!amount || !recipient || recipientValid === false || error) return false;
    if (!isSendMax && showCoinControl && selectedTotal < (parseInt(amount || '0') + calculateTotalFee())) return false;
    return true;
  };

  // Calculate fiat value for input hint
  const amountInSats = parseInt(amount || '0');
  const amountInFiat = getFiatValue(amountInSats).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Validate recipient address
  useEffect(() => {
    const validateAddress = async () => {
      if (!recipient || recipient.length < 10) {
        setRecipientValid(null);
        return;
      }

      // In consolidation mode, if the address is in our wallet, it's valid
      if (isConsolidation && walletAddresses.includes(recipient)) {
        setRecipientValid(true);
        return;
      }

      try {
        const result = await bitcoinApi.validateAddress({ address: recipient });
        setRecipientValid(result.valid);
      } catch (err) {
        console.error('Address validation error:', err);
        setRecipientValid(false);
      }
    };

    const timer = setTimeout(validateAddress, 500); // Debounce
    return () => clearTimeout(timer);
  }, [recipient, isConsolidation, walletAddresses]);

  // Handle transaction broadcast
  const handleBroadcast = async () => {
    if (!wallet || !id) return;

    try {
      setBroadcasting(true);
      setError(null);

      // Validate inputs
      if (!recipient) {
        setError('Please enter a recipient address');
        return;
      }

      if (recipientValid === false) {
        setError('Invalid recipient address');
        return;
      }

      if (!amount || parseInt(amount) <= 0) {
        setError('Please enter a valid amount');
        return;
      }

      const amountSats = parseInt(amount);

      // Step 1: Create transaction PSBT
      const txData = await transactionsApi.createTransaction(id, {
        recipient,
        amount: amountSats,
        feeRate,
        selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
        enableRBF,
        sendMax: isSendMax,
        subtractFees: subtractFeesFromAmount,
      });

      // Check if balance is sufficient (skip for sendMax since backend already validated)
      if (!isSendMax && !subtractFeesFromAmount) {
        const totalNeeded = amountSats + txData.fee;
        if (wallet.balance < totalNeeded) {
          setError(`Insufficient funds. Need ${format(totalNeeded)} but have ${format(wallet.balance)}`);
          return;
        }
      }

      // Step 2: Sign with hardware wallet
      if (hardwareWallet.isConnected && hardwareWallet.device) {
        try {
          // Sign the PSBT with hardware wallet
          const signedPsbt = await hardwareWallet.signPSBT(txData.psbtBase64);

          // Step 3: Broadcast the signed transaction
          const broadcastResult = await transactionsApi.broadcastTransaction(id, {
            signedPsbtBase64: signedPsbt,
            recipient,
            amount: amountSats,
            fee: txData.fee,
            utxos: txData.utxos,
          });

          showSuccess(
            `Transaction broadcast successfully! TXID: ${broadcastResult.txid.substring(0, 16)}... Amount: ${format(amountSats)}, Fee: ${format(txData.fee)}`,
            'Transaction Broadcast'
          );

          // Delete draft after successful broadcast
          if (currentDraftId) {
            try {
              await draftsApi.deleteDraft(id, currentDraftId);
            } catch (e) {
              console.error('Failed to delete draft after broadcast:', e);
            }
          }

          navigate(`/wallets/${id}`);
          return;
        } catch (hwError) {
          console.error('Hardware wallet signing failed:', hwError);
          setError(hwError instanceof Error ? hwError.message : 'Hardware wallet signing failed');
          return;
        }
      }

      // If no hardware wallet, show connection prompt
      showInfo(
        `Transaction ready for signing. Amount: ${format(amountSats)}, Fee: ${format(txData.fee)}. Connect a hardware wallet to sign securely.`,
        'Connect Hardware Wallet'
      );

      // Prompt to connect hardware wallet
      setShowHWConnect(true);

    } catch (err) {
      console.error('Transaction broadcast error:', err);
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
      console.error('Hardware wallet connection failed:', err);
    }
  };

  // Save transaction as draft for later signing/broadcast
  const handleSaveAsDraft = async () => {
    if (!wallet || !id) return;

    try {
      setSavingDraft(true);
      setError(null);

      // Validate inputs
      if (!recipient) {
        setError('Please enter a recipient address');
        return;
      }

      if (recipientValid === false) {
        setError('Invalid recipient address');
        return;
      }

      if (!amount || parseInt(amount) <= 0) {
        setError('Please enter a valid amount');
        return;
      }

      const amountSats = parseInt(amount);

      // Create PSBT for the draft
      const txData = await transactionsApi.createTransaction(id, {
        recipient,
        amount: amountSats,
        feeRate,
        selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
        enableRBF,
        sendMax: isSendMax,
        subtractFees: subtractFeesFromAmount,
      });

      const draftRequest: draftsApi.CreateDraftRequest = {
        recipient,
        amount: amountSats,
        feeRate,
        selectedUtxoIds: selectedUTXOs.size > 0 ? Array.from(selectedUTXOs) : undefined,
        enableRBF,
        subtractFees: subtractFeesFromAmount,
        sendMax: isSendMax,
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
        // Update existing draft
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
      console.error('Save draft error:', err);
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
            <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">Send Bitcoin</h1>
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

            <div className="space-y-2">
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                  {isConsolidation ? 'Consolidation Address (Your Wallet)' : 'Recipient Address'}
                  {isResumingDraft && (
                    <span className="ml-2 text-xs text-sanctuary-500">(locked - resuming draft)</span>
                  )}
                </label>
                {isConsolidation ? (
                  <div className="relative">
                    <select
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
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
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            disabled={isResumingDraft}
                            placeholder="bc1q..."
                            className={`block w-full px-4 py-3 rounded-xl border ${
                              recipientValid === true
                                ? 'border-green-500 dark:border-green-400'
                                : recipientValid === false
                                ? 'border-rose-500 dark:border-rose-400'
                                : 'border-sanctuary-300 dark:border-sanctuary-700'
                            } surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors ${isResumingDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
                        />
                        {recipientValid === true && (
                          <Check className="absolute right-4 top-3.5 w-5 h-5 text-green-500" />
                        )}
                        {recipientValid === false && (
                          <X className="absolute right-4 top-3.5 w-5 h-5 text-rose-500" />
                        )}
                      </div>
                      {!isResumingDraft && (
                        <Button variant="secondary" onClick={() => (showScanner ? (setShowScanner(false), stopCamera()) : startCamera())}>
                            {showScanner ? <X className="w-5 h-5" /> : <QrCode className="w-5 h-5" />}
                        </Button>
                      )}
                  </div>
                )}
                {!isConsolidation && recipientValid === false && (
                  <p className="text-xs text-rose-500">Invalid Bitcoin address</p>
                )}
                {!isConsolidation && showScanner && (
                   <div className="relative overflow-hidden rounded-xl bg-black aspect-video flex items-center justify-center">
                       <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
                       <canvas ref={canvasRef} className="hidden" />
                       <div className="z-10 border-2 border-white/50 w-48 h-48 rounded-lg"></div>
                       <p className="absolute bottom-4 z-10 text-white bg-black/50 px-3 py-1 rounded-full text-xs">Scan Bitcoin QR Code</p>
                   </div>
                )}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Amount (sats)</label>
                  <button
                    type="button"
                    onClick={() => {
                      // Mark as send max - the backend will calculate the exact amount
                      setIsSendMax(true);
                      // Use current fee rate or default to standard fee
                      const currentFeeRate = feeRate || fees?.halfHourFee || 10;
                      // For MAX send, there's no change output (only 1 output)
                      // Native segwit: inputs ~68 vB each, output ~31 vB, overhead ~10.5 vB
                      const numInputs = selectedUTXOs.size > 0 ? selectedUTXOs.size : utxos.length;
                      const estimatedVBytes = (numInputs * 68) + 31 + 11; // 1 output for max send
                      const estimatedFee = Math.ceil(estimatedVBytes * currentFeeRate);
                      const availableBalance = selectedUTXOs.size > 0 ? selectedTotal : (wallet?.balance || 0);
                      const maxAmount = Math.max(0, availableBalance - estimatedFee);
                      setAmount(maxAmount.toString());
                      // Select all UTXOs if none selected
                      if (selectedUTXOs.size === 0 && utxos.length > 0) {
                        setSelectedUTXOs(new Set(utxos.map(u => `${u.txid}:${u.vout}`)));
                        setShowCoinControl(true);
                      }
                    }}
                    className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                <div className="relative">
                   <input
                       type="number"
                       value={amount}
                       onChange={(e) => {
                         setAmount(e.target.value);
                         setIsSendMax(false); // User manually changed amount, no longer send max
                       }}
                       placeholder="0"
                       className="block w-full px-4 py-3 pr-24 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors"
                   />
                   <div className="absolute right-4 top-3.5 text-sanctuary-400 text-sm flex items-center pointer-events-none">
                      {amountInSats > 0 && <span className="mr-2 text-sanctuary-500 dark:text-sanctuary-400">≈ {currencySymbol}{amountInFiat}</span>}
                      <span>SATS</span>
                   </div>
                </div>
                {showCoinControl && (
                   <div className="text-right text-xs text-sanctuary-500">
                      Selected: {format(selectedTotal)}
                   </div>
                )}
            </div>

            {/* Advanced Options */}
            <div className="border-t border-sanctuary-200 dark:border-sanctuary-800 pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200 transition-colors"
              >
                <Sliders className="w-4 h-4 mr-2" />
                Advanced Options
                <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-3 pl-6">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableRBF}
                      onChange={(e) => setEnableRBF(e.target.checked)}
                      className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
                    />
                    <div>
                      <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable RBF</span>
                      <p className="text-xs text-sanctuary-500">Replace-by-Fee allows you to bump the fee later if the transaction is stuck</p>
                    </div>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subtractFeesFromAmount}
                      onChange={(e) => setSubtractFeesFromAmount(e.target.checked)}
                      className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
                    />
                    <div>
                      <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Subtract fees from amount</span>
                      <p className="text-xs text-sanctuary-500">Deduct network fees from the amount sent instead of adding to total</p>
                    </div>
                  </label>
                </div>
              )}
            </div>
        </div>

        {/* Fee Selection */}
        <div className="space-y-4">
             <div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">Network Fee</h3>
                <p className="text-sm text-sanctuary-500 mb-4">Click a block below to target its confirmation speed, or select a preset.</p>
                <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-2 mb-4 overflow-hidden">
                    <BlockVisualizer
                      blocks={mempoolBlocks}
                      queuedBlocksSummary={queuedBlocksSummary}
                      onBlockClick={(rate) => setFeeRate(rate)}
                      compact={true}
                    />
                </div>
             </div>

             <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                        { label: 'High Priority', rate: fees?.fastestFee, time: '~10 mins' },
                        { label: 'Standard', rate: fees?.halfHourFee, time: '~30 mins' },
                        { label: 'Economy', rate: fees?.hourFee, time: '~1 hour' },
                    ].map((opt) => (
                        <div 
                           key={opt.label}
                           onClick={() => setFeeRate(opt.rate || 1)}
                           className={`cursor-pointer p-4 rounded-xl border transition-all ${feeRate === opt.rate ? 'border-sanctuary-800 dark:border-sanctuary-200 surface-secondary' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'}`}
                        >
                            <div className="font-medium text-sm">{opt.label}</div>
                            <div className="text-2xl font-bold my-1">{opt.rate} <span className="text-xs font-normal text-sanctuary-500">sat/vB</span></div>
                            <div className="text-xs text-sanctuary-400">{opt.time}</div>
                        </div>
                    ))}
                </div>
                <div className="pt-4 mt-2 border-t border-sanctuary-100 dark:border-sanctuary-800">
                    <label className="text-xs font-medium text-sanctuary-500 uppercase">Custom Fee Rate</label>
                    <input 
                       type="number" 
                       value={feeRate} 
                       onChange={(e) => setFeeRate(parseInt(e.target.value))}
                       className="mt-1 block w-32 px-3 py-2 text-sm rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 bg-transparent focus:ring-2 focus:ring-sanctuary-500"
                    />
                </div>
             </div>
        </div>

        {/* Coin Control Toggle */}
        <div className="flex items-center justify-between">
           <button 
             onClick={() => setShowCoinControl(!showCoinControl)}
             className="flex items-center text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200"
           >
              <Sliders className="w-4 h-4 mr-2" />
              {showCoinControl ? 'Hide Coin Control' : 'Coin Control (Auto)'}
           </button>
        </div>

        {/* UTXO Selection Table */}
        {showCoinControl && (
            <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden animate-fade-in">
                <div className="p-4 surface-muted border-b border-sanctuary-100 dark:border-sanctuary-800 flex justify-between items-center">
                    <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Select Inputs</span>
                    <span className="text-xs text-sanctuary-500">{selectedUTXOs.size} selected</span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                    {utxos.map(utxo => {
                        const id = `${utxo.txid}:${utxo.vout}`;
                        const isSelected = selectedUTXOs.has(id);
                        // Striped pattern for frozen UTXOs (matching UTXO page styling with muted red)
                        const frozenStyle = utxo.frozen ? {
                          backgroundImage: `repeating-linear-gradient(
                            45deg,
                            transparent,
                            transparent 4px,
                            rgba(190,18,60,0.08) 4px,
                            rgba(190,18,60,0.08) 8px
                          )`
                        } : {};
                        return (
                            <div
                                key={id}
                                onClick={() => !utxo.frozen && toggleUTXO(id)}
                                style={frozenStyle}
                                className={`p-4 flex items-center justify-between border-b border-sanctuary-50 dark:border-sanctuary-800 last:border-0 cursor-pointer transition-colors ${isSelected ? 'bg-amber-50 dark:bg-amber-900/10' : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'} ${utxo.frozen ? 'opacity-70 cursor-not-allowed bg-rose-50 dark:bg-rose-900/10' : ''}`}
                            >
                                <div className="flex items-center space-x-3">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${isSelected ? 'bg-sanctuary-800 border-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900' : 'border-sanctuary-300 dark:border-sanctuary-600'}`}>
                                        {isSelected && <Check className="w-3 h-3" />}
                                    </div>
                                    <div>
                                        <div className="font-mono text-sm font-medium">{format(utxo.amount)}</div>
                                        <div className="text-xs text-sanctuary-400 truncate w-48">{utxo.address}</div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    {utxo.frozen && (
                                      <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 mb-1 mr-1">
                                        Frozen
                                      </span>
                                    )}
                                    {utxo.label && <span className="inline-block px-2 py-0.5 rounded text-[10px] surface-secondary text-sanctuary-600 dark:text-sanctuary-400 mb-1">{utxo.label}</span>}
                                    <div className="text-xs text-sanctuary-400">{utxo.confirmations} confs</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}
        
        {/* Warning if insufficient funds selected via coin control (not shown for sendMax) */}
        {showCoinControl && !isSendMax && selectedTotal < (parseInt(amount || '0') + calculateTotalFee()) && parseInt(amount || '0') > 0 && (
             <div className="flex items-center p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-xl">
                 <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
                 <span className="text-sm">Selected inputs are insufficient to cover amount + estimated fees.</span>
             </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="flex items-center p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-800 dark:text-rose-200 rounded-xl">
            <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Multisig Signing Panel */}
        {wallet?.type === WalletType.MULTI_SIG && walletDevices.length > 0 && (
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
                    {wallet.quorum?.m} of {wallet.quorum?.n} signatures required
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`text-sm font-medium ${
                  signedDevices.size >= (wallet.quorum?.m || 1)
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-sanctuary-500'
                }`}>
                  {signedDevices.size} / {wallet.quorum?.m} collected
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
                    console.error('Signing failed:', err);
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
                    console.error('Failed to download PSBT:', err);
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
                    console.log('Uploaded signed PSBT:', content.substring(0, 50) + '...');
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
                <span>{Math.round((signedDevices.size / (wallet.quorum?.m || 1)) * 100)}%</span>
              </div>
              <div className="h-2 bg-blue-200 dark:bg-blue-800/50 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    signedDevices.size >= (wallet.quorum?.m || 1)
                      ? 'bg-green-500'
                      : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, (signedDevices.size / (wallet.quorum?.m || 1)) * 100)}%` }}
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
        {wallet?.type !== WalletType.MULTI_SIG && hardwareWallet.isConnected && hardwareWallet.device && (
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
        {wallet?.type !== WalletType.MULTI_SIG && !hardwareWallet.isConnected && (() => {
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
              console.error('Failed to download PSBT:', err);
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
              console.log('Uploaded signed PSBT:', content.substring(0, 50) + '...');
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
                                    console.error('Connection failed:', err);
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
             <Button
               size="lg"
               className="w-full shadow-lg shadow-sanctuary-900/10 dark:shadow-black/20"
               disabled={!amount || !recipient || recipientValid === false || broadcasting || hardwareWallet.signing}
               onClick={handleBroadcast}
             >
                 {broadcasting || hardwareWallet.signing ? (
                   <>
                     <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                     {hardwareWallet.signing ? 'Signing with Device...' : 'Broadcasting...'}
                   </>
                 ) : wallet?.type === WalletType.MULTI_SIG ? (
                   hardwareWallet.isConnected ? (
                     <>
                       <Shield className="w-5 h-5 mr-2" />
                       Sign with {hardwareWallet.device?.name} ({signedDevices.size + 1}/{wallet.quorum?.m})
                     </>
                   ) : (
                     <>
                       <Users className="w-5 h-5 mr-2" />
                       Collect Signatures ({signedDevices.size}/{wallet.quorum?.m} of {wallet.quorum?.n})
                     </>
                   )
                 ) : hardwareWallet.isConnected ? (
                   <>
                     <Shield className="w-5 h-5 mr-2" />
                     Sign with {hardwareWallet.device?.name}
                   </>
                 ) : (
                   'Sign & Broadcast Transaction'
                 )}
             </Button>

             {/* Save as Draft Button */}
             <button
               onClick={handleSaveAsDraft}
               disabled={!amount || !recipient || recipientValid === false || savingDraft}
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