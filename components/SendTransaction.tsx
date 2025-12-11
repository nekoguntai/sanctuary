import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Wallet, UTXO, FeeEstimate, WalletType } from '../types';
import * as walletsApi from '../src/api/wallets';
import * as transactionsApi from '../src/api/transactions';
import * as bitcoinApi from '../src/api/bitcoin';
import { ApiError } from '../src/api/client';
import { Button } from './ui/Button';
import { BlockVisualizer } from './BlockVisualizer';
import type { BlockData, QueuedBlocksSummary } from '../src/api/bitcoin';
import { HardwareWalletConnect } from './HardwareWalletConnect';
import { useHardwareWallet } from '../hooks/useHardwareWallet';
import { ArrowLeft, Camera, Check, X, QrCode, Sliders, AlertTriangle, Loader2, Shield, Usb } from 'lucide-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { useUser } from '../contexts/UserContext';
import jsQR from 'jsqr';

export const SendTransaction: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { format, getFiatValue, currencySymbol } = useCurrency();
  const { user } = useUser();

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

  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipientValid, setRecipientValid] = useState<boolean | null>(null);
  
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

      const formattedWallet: Wallet = {
        id: apiWallet.id,
        name: apiWallet.name,
        type: apiWallet.type as WalletType,
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

      // Fetch UTXOs, fees, and mempool data - all needed for sending transactions
      try {
        const [utxoData, feeEstimates, mempoolData] = await Promise.all([
          transactionsApi.getUTXOs(id),
          bitcoinApi.getFeeEstimates(),
          bitcoinApi.getMempoolData().catch(() => null) // Don't fail if mempool data unavailable
        ]);

        // Format UTXOs
        const formattedUTXOs: UTXO[] = utxoData.utxos.map(utxo => ({
          id: utxo.id,
          txid: utxo.txid,
          vout: utxo.vout,
          amount: Number(utxo.amount),
          address: utxo.address,
          confirmations: utxo.confirmations,
          spendable: !utxo.spent,
          scriptType: formattedWallet.scriptType,
        }));
        setUTXOs(formattedUTXOs);

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

      // Handle Pre-selected UTXOs from Wallet View
      if (location.state && (location.state as any).preSelected) {
        const pre = (location.state as any).preSelected as string[];
        if (pre.length > 0) {
          setSelectedUTXOs(new Set(pre));
          setShowCoinControl(true);
        }
      }

      setLoading(false);
    };
    init();

    return () => stopCamera();
  }, [id, location.state, user]);

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
      alert("Unable to access camera");
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
      const vbytes = (inputs * 148) + (2 * 34) + 10;
      return vbytes * feeRate;
  }

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

      try {
        const result = await bitcoinApi.validateAddress(recipient);
        setRecipientValid(result.valid);
      } catch (err) {
        console.error('Address validation error:', err);
        setRecipientValid(false);
      }
    };

    const timer = setTimeout(validateAddress, 500); // Debounce
    return () => clearTimeout(timer);
  }, [recipient]);

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
        enableRBF: true,
      });

      // Check if balance is sufficient
      const totalNeeded = amountSats + txData.fee;
      if (wallet.balance < totalNeeded) {
        setError(`Insufficient funds. Need ${format(totalNeeded)} but have ${format(wallet.balance)}`);
        return;
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

          alert(
            `Transaction Signed & Broadcast! 🎉\n\n` +
            `Transaction ID: ${broadcastResult.txid.substring(0, 16)}...\n\n` +
            `Details:\n` +
            `To: ${recipient.substring(0, 20)}...\n` +
            `Amount: ${format(amountSats)}\n` +
            `Fee: ${format(txData.fee)}\n` +
            `Total: ${format(totalNeeded)}\n\n` +
            `Signed with: ${hardwareWallet.device.name}`
          );

          navigate(`/wallets/${id}`);
          return;
        } catch (hwError) {
          console.error('Hardware wallet signing failed:', hwError);
          setError(hwError instanceof Error ? hwError.message : 'Hardware wallet signing failed');
          return;
        }
      }

      // If no hardware wallet, show connection prompt
      alert(
        `Transaction Ready to Sign\n\n` +
        `To: ${recipient}\n` +
        `Amount: ${format(amountSats)}\n` +
        `Fee: ${format(txData.fee)}\n` +
        `Total: ${format(totalNeeded)}\n\n` +
        `Connect a hardware wallet to sign this transaction securely.\n\n` +
        `Supported devices:\n` +
        `• Coldcard (Mk3, Mk4, Q)\n` +
        `• Ledger (Nano S, X, S Plus)\n` +
        `• Trezor (One, Model T, Safe 3)\n` +
        `• BitBox02\n` +
        `• Passport\n` +
        `• Blockstream Jade`
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
                <div className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">{format(wallet.balance)}</div>
            </div>
        </div>

        {/* Recipient & Amount */}
        <div className="bg-white dark:bg-sanctuary-900 p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 space-y-6">
            <div className="space-y-2">
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Recipient Address</label>
                <div className="flex space-x-2">
                    <div className="flex-1 relative">
                      <input
                          type="text"
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                          placeholder="bc1q..."
                          className={`block w-full px-4 py-3 rounded-xl border ${
                            recipientValid === true
                              ? 'border-green-500 dark:border-green-400'
                              : recipientValid === false
                              ? 'border-rose-500 dark:border-rose-400'
                              : 'border-sanctuary-300 dark:border-sanctuary-700'
                          } bg-sanctuary-50 dark:bg-sanctuary-950 focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors`}
                      />
                      {recipientValid === true && (
                        <Check className="absolute right-4 top-3.5 w-5 h-5 text-green-500" />
                      )}
                      {recipientValid === false && (
                        <X className="absolute right-4 top-3.5 w-5 h-5 text-rose-500" />
                      )}
                    </div>
                    <Button variant="secondary" onClick={() => (showScanner ? (setShowScanner(false), stopCamera()) : startCamera())}>
                        {showScanner ? <X className="w-5 h-5" /> : <QrCode className="w-5 h-5" />}
                    </Button>
                </div>
                {recipientValid === false && (
                  <p className="text-xs text-rose-500">Invalid Bitcoin address</p>
                )}
                {showScanner && (
                   <div className="relative overflow-hidden rounded-xl bg-black aspect-video flex items-center justify-center">
                       <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
                       <canvas ref={canvasRef} className="hidden" />
                       <div className="z-10 border-2 border-white/50 w-48 h-48 rounded-lg"></div>
                       <p className="absolute bottom-4 z-10 text-white bg-black/50 px-3 py-1 rounded-full text-xs">Scan Bitcoin QR Code</p>
                   </div>
                )}
            </div>

            <div className="space-y-2">
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Amount (sats)</label>
                <div className="relative">
                   <input 
                       type="number"
                       value={amount}
                       onChange={(e) => setAmount(e.target.value)}
                       placeholder="0"
                       className="block w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 bg-sanctuary-50 dark:bg-sanctuary-950 focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors"
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
        </div>

        {/* Fee Selection */}
        <div className="space-y-4">
             <div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">Network Fee</h3>
                <p className="text-sm text-sanctuary-500 mb-4">Click a block below to target its confirmation speed, or select a preset.</p>
                <div className="bg-white dark:bg-sanctuary-900 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-2 mb-4 overflow-hidden">
                    <BlockVisualizer
                      blocks={mempoolBlocks}
                      queuedBlocksSummary={queuedBlocksSummary}
                      onBlockClick={(rate) => setFeeRate(rate)}
                      compact={true}
                    />
                </div>
             </div>

             <div className="bg-white dark:bg-sanctuary-900 p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                        { label: 'High Priority', rate: fees?.fastestFee, time: '~10 mins' },
                        { label: 'Standard', rate: fees?.halfHourFee, time: '~30 mins' },
                        { label: 'Economy', rate: fees?.hourFee, time: '~1 hour' },
                    ].map((opt) => (
                        <div 
                           key={opt.label}
                           onClick={() => setFeeRate(opt.rate || 1)}
                           className={`cursor-pointer p-4 rounded-xl border transition-all ${feeRate === opt.rate ? 'border-sanctuary-800 dark:border-sanctuary-200 bg-sanctuary-50 dark:bg-sanctuary-800' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'}`}
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
            <div className="bg-white dark:bg-sanctuary-900 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden animate-fade-in">
                <div className="p-4 bg-sanctuary-50 dark:bg-sanctuary-950 border-b border-sanctuary-100 dark:border-sanctuary-800 flex justify-between items-center">
                    <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Select Inputs</span>
                    <span className="text-xs text-sanctuary-500">{selectedUTXOs.size} selected</span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                    {utxos.map(utxo => {
                        const id = `${utxo.txid}:${utxo.vout}`;
                        const isSelected = selectedUTXOs.has(id);
                        return (
                            <div 
                                key={id} 
                                onClick={() => !utxo.frozen && toggleUTXO(id)}
                                className={`p-4 flex items-center justify-between border-b border-sanctuary-50 dark:border-sanctuary-800 last:border-0 cursor-pointer transition-colors ${isSelected ? 'bg-amber-50 dark:bg-amber-900/10' : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'} ${utxo.frozen ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                                    {utxo.label && <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 mb-1">{utxo.label}</span>}
                                    <div className="text-xs text-sanctuary-400">{utxo.confirmations} confs</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}
        
        {/* Warning if insufficient funds selected via coin control */}
        {showCoinControl && selectedTotal < (parseInt(amount || '0') + calculateTotalFee()) && parseInt(amount || '0') > 0 && (
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

        {/* Hardware Wallet Status */}
        {hardwareWallet.isConnected && hardwareWallet.device && (
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

        {/* Hardware Wallet Connect Button */}
        {!hardwareWallet.isConnected && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-500/20 rounded-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1">
                <Usb className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                    Hardware Wallet Recommended
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                    Connect your hardware wallet to sign transactions securely. Your keys never leave the device.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowHWConnect(true)}
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Connect Hardware Wallet
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white dark:bg-sanctuary-900 border-t border-sanctuary-200 dark:border-sanctuary-800 md:static md:bg-transparent md:border-0 md:p-0">
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
                 ) : hardwareWallet.isConnected ? (
                   <>
                     <Shield className="w-5 h-5 mr-2" />
                     Sign with {hardwareWallet.device?.name}
                   </>
                 ) : (
                   'Sign & Broadcast Transaction'
                 )}
             </Button>
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