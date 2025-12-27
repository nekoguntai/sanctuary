/**
 * ReviewStep Component
 *
 * Final step of the transaction wizard.
 * Shows transaction summary and handles signing/broadcasting.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Send,
  Save,
  Check,
  AlertTriangle,
  Shield,
  Layers,
  ChevronLeft,
  FileDown,
  Upload,
  Loader2,
  CheckCircle2,
  Usb,
  QrCode,
} from 'lucide-react';
import { QRSigningModal } from '../../qr';
import { Button } from '../../ui/Button';
import { TransactionFlowPreview, FlowInput, FlowOutput } from '../../TransactionFlowPreview';
import { useSendTransaction } from '../../../contexts/send';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { createLogger } from '../../../utils/logger';
import { STEP_LABELS } from '../../../contexts/send/types';
import type { WizardStep } from '../../../contexts/send/types';
import type { TransactionData } from '../../../hooks/useSendTransactionActions';
import type { Device } from '../../../types';

const log = createLogger('ReviewStep');

// Device connection capabilities
type ConnectionMethod = 'usb' | 'airgap' | 'qr';

interface DeviceCapabilities {
  methods: ConnectionMethod[];
  labels: Record<ConnectionMethod, string>;
}

const getDeviceCapabilities = (deviceType: string): DeviceCapabilities => {
  const normalizedType = deviceType.toLowerCase();

  if (normalizedType.includes('coldcard')) {
    return { methods: ['usb', 'airgap'], labels: { usb: 'USB', airgap: 'PSBT File', qr: '' } };
  }
  if (normalizedType.includes('ledger') || normalizedType.includes('trezor') || normalizedType.includes('bitbox') || normalizedType.includes('jade')) {
    return { methods: ['usb'], labels: { usb: 'USB', airgap: '', qr: '' } };
  }
  if (normalizedType.includes('passport') || normalizedType.includes('foundation') || normalizedType.includes('keystone') || normalizedType.includes('seedsigner')) {
    return { methods: ['qr', 'airgap'], labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' } };
  }
  return { methods: ['usb', 'airgap'], labels: { usb: 'USB', airgap: 'PSBT File', qr: '' } };
};

export interface ReviewStepProps {
  // Handlers from parent
  onSign?: () => void;
  onBroadcast?: () => void;
  onSaveDraft?: () => void;
  // Loading states
  signing?: boolean;
  broadcasting?: boolean;
  savingDraft?: boolean;
  // Additional props for signing UI
  error?: string | null;
  txData?: TransactionData | null;
  unsignedPsbt?: string | null;
  signedDevices?: Set<string>;
  payjoinStatus?: 'idle' | 'attempting' | 'success' | 'failed';
  onCreateTransaction?: () => Promise<TransactionData | null>;
  onDownloadPsbt?: () => void;
  onUploadSignedPsbt?: (file: File) => Promise<void>;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  onMarkDeviceSigned?: (deviceId: string) => void;
  onProcessQrSignedPsbt?: (signedPsbt: string, deviceId: string) => void;
  onBroadcastSigned?: () => Promise<boolean>;
  hardwareWallet?: any;
  // Draft mode - locks editing, shows draft info
  isDraftMode?: boolean;
}

export function ReviewStep({
  onSign,
  onBroadcast,
  onSaveDraft,
  signing = false,
  broadcasting = false,
  savingDraft = false,
  error,
  txData,
  unsignedPsbt,
  signedDevices = new Set(),
  payjoinStatus = 'idle',
  onCreateTransaction,
  onDownloadPsbt,
  onUploadSignedPsbt,
  onSignWithDevice,
  onMarkDeviceSigned,
  onProcessQrSignedPsbt,
  onBroadcastSigned,
  hardwareWallet,
  isDraftMode = false,
}: ReviewStepProps) {
  const {
    state,
    wallet,
    devices,
    utxos,
    spendableUtxos,
    walletAddresses,
    selectedTotal,
    estimatedFee,
    totalOutputAmount,
    goToStep,
    prevStep,
    isReadyToSign,
  } = useSendTransaction();

  const { format, formatFiat } = useCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [signingDeviceId, setSigningDeviceId] = useState<string | null>(null);
  const [qrSigningDevice, setQrSigningDevice] = useState<Device | null>(null);

  // Calculate change amount
  const changeAmount = useMemo(() => {
    if (state.outputs.some(o => o.sendMax)) {
      return 0;
    }
    return Math.max(0, selectedTotal - totalOutputAmount - estimatedFee);
  }, [selectedTotal, totalOutputAmount, estimatedFee, state.outputs]);

  // Create a set of known wallet addresses for quick lookup
  const knownAddresses = useMemo(() => {
    return new Set(walletAddresses.map(wa => wa.address));
  }, [walletAddresses]);

  // Helper to get label for an address if it belongs to our wallet
  const getAddressLabel = useCallback((address: string): string | undefined => {
    if (knownAddresses.has(address)) {
      return wallet.name;
    }
    return undefined;
  }, [knownAddresses, wallet.name]);

  // Build flow visualization data
  const flowData = useMemo(() => {
    // Get selected UTXOs for inputs
    const selectedUtxoIds = state.selectedUTXOs;
    const inputUtxos = selectedUtxoIds.size > 0
      ? utxos.filter(u => selectedUtxoIds.has(`${u.txid}:${u.vout}`))
      : spendableUtxos;

    // Build inputs from actual txData if available, otherwise estimate from UTXOs
    const inputs: FlowInput[] = txData?.utxos
      ? txData.utxos.map(u => {
          // Use data from txData if available (draft mode includes address/amount)
          // Fall back to lookup from utxos array if needed
          const hasData = u.address && u.amount;
          const utxo = hasData ? null : utxos.find(ux => ux.txid === u.txid && ux.vout === u.vout);
          const address = u.address || utxo?.address || '';
          return {
            txid: u.txid,
            vout: u.vout,
            address,
            amount: u.amount || utxo?.amount || 0,
            label: getAddressLabel(address),
          };
        })
      : inputUtxos.map(u => ({
          txid: u.txid,
          vout: u.vout,
          address: u.address,
          amount: u.amount,
          label: getAddressLabel(u.address),
        }));

    // Build outputs - prefer txData.outputs (includes decoys) over state.outputs
    const outputs: FlowOutput[] = txData?.outputs && txData.outputs.length > 0
      ? txData.outputs.map(o => ({
          address: o.address,
          amount: o.amount,
          isChange: false,
          label: getAddressLabel(o.address),
        }))
      : state.outputs.map(o => ({
          address: o.address,
          amount: o.sendMax
            ? selectedTotal - (txData?.fee || estimatedFee)
            : parseInt(o.amount) || 0,
          isChange: false,
          label: getAddressLabel(o.address),
        }));

    // Add decoy outputs if present (these are change outputs distributed for privacy)
    // Or add single change output if no decoys
    const actualChangeAmount = txData?.changeAmount ?? changeAmount;
    if (txData?.decoyOutputs && txData.decoyOutputs.length > 0) {
      txData.decoyOutputs.forEach(decoy => {
        outputs.push({
          address: decoy.address,
          amount: decoy.amount,
          isChange: true,
          label: getAddressLabel(decoy.address),
        });
      });
    } else if (actualChangeAmount > 0) {
      const changeAddr = txData?.changeAddress || 'Change address';
      outputs.push({
        address: changeAddr,
        amount: actualChangeAmount,
        isChange: true,
        label: getAddressLabel(changeAddr),
      });
    }

    const totalInput = txData?.totalInput ?? selectedTotal;
    const totalOutput = txData?.totalOutput ?? (totalOutputAmount + actualChangeAmount);
    const fee = txData?.fee ?? estimatedFee;

    return { inputs, outputs, totalInput, totalOutput, fee };
  }, [state.outputs, state.selectedUTXOs, utxos, spendableUtxos, txData, selectedTotal, totalOutputAmount, estimatedFee, changeAmount, getAddressLabel]);

  // Transaction type label
  const txTypeLabel = useMemo(() => {
    switch (state.transactionType) {
      case 'consolidation':
        return 'Consolidation';
      case 'sweep':
        return 'Sweep';
      default:
        return 'Standard Send';
    }
  }, [state.transactionType]);

  // Edit section handler
  const handleEdit = (step: WizardStep) => {
    goToStep(step);
  };

  // Check if multi-sig
  const isMultiSig = wallet.type === 'Multi Sig' || wallet.type === 'multi_sig';

  // Debug logging
  log.debug('Review step state', {
    walletType: wallet.type,
    isMultiSig,
    hasTxData: !!txData,
    devicesCount: devices.length,
    devices: devices.map(d => ({ id: d.id, type: d.type, label: d.label })),
    walletAddressesCount: walletAddresses.length,
    isDraftMode,
  });

  // Get required signatures
  const requiredSignatures = typeof wallet.quorum === 'object'
    ? wallet.quorum.m
    : wallet.quorum || 1;

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && onUploadSignedPsbt) {
      await onUploadSignedPsbt(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Check if we have enough signatures for multi-sig
  const hasEnoughSignatures = isMultiSig
    ? signedDevices.size >= requiredSignatures
    : signedDevices.size > 0 || (hardwareWallet?.isConnected && hardwareWallet?.device);

  // Can broadcast?
  const canBroadcast = txData && (hasEnoughSignatures || signedDevices.has('psbt-signed'));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          {isDraftMode ? 'Resume Draft' : 'Review Transaction'}
        </h2>
        <p className="text-sm text-sanctuary-500 mt-1">
          {isDraftMode
            ? 'Sign and broadcast this saved transaction'
            : 'Please verify all details before signing'
          }
        </p>
        {isDraftMode && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
            <Save className="w-3 h-3" />
            Saved Draft - Parameters Locked
          </div>
        )}
      </div>

      {/* Transaction Flow Visualization */}
      {flowData.inputs.length > 0 && flowData.outputs.length > 0 && (
        <TransactionFlowPreview
          inputs={flowData.inputs}
          outputs={flowData.outputs}
          fee={flowData.fee}
          feeRate={state.feeRate}
          totalInput={flowData.totalInput}
          totalOutput={flowData.totalOutput}
          isEstimate={!txData}
        />
      )}

      {/* Transaction Summary Card */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        {/* Type Badge */}
        <div className="px-4 py-3 surface-secondary border-b border-sanctuary-200 dark:border-sanctuary-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              {state.transactionType === 'consolidation' ? (
                <Layers className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              ) : (
                <Send className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              )}
            </div>
            <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {txTypeLabel}
            </span>
          </div>
          {!isDraftMode && (
            <button
              onClick={() => handleEdit('type')}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              Change
            </button>
          )}
        </div>

        {/* Recipients Section */}
        <div className="p-4 border-b border-sanctuary-200 dark:border-sanctuary-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-sanctuary-500">
              {state.outputs.length === 1 ? 'Recipient' : `Recipients (${state.outputs.length})`}
            </h3>
            {!isDraftMode && (
              <button
                onClick={() => handleEdit('outputs')}
                className="text-xs text-primary-600 hover:text-primary-700"
              >
                Edit
              </button>
            )}
          </div>

          <div className="space-y-3">
            {state.outputs.map((output, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg surface-secondary"
              >
                <div className="flex-1 min-w-0 mr-4">
                  <div className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate">
                    {output.address || '(no address)'}
                  </div>
                  {state.payjoinUrl && index === 0 && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-zen-indigo">
                      <Shield className="w-3 h-3" />
                      Payjoin {payjoinStatus === 'success' ? 'active' : payjoinStatus === 'failed' ? '(fallback)' : 'enabled'}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                    {output.sendMax ? 'MAX' : format(parseInt(output.amount) || 0)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Amounts Section */}
        <div className="p-4 space-y-3">
          {/* Total Send */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-sanctuary-500">Total Sending</span>
            <div className="text-right">
              <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                {state.outputs.some(o => o.sendMax)
                  ? format(selectedTotal - estimatedFee)
                  : format(totalOutputAmount)
                }
              </div>
              {formatFiat(totalOutputAmount) && (
                <div className="text-xs text-sanctuary-500">
                  ≈ {formatFiat(totalOutputAmount)}
                </div>
              )}
            </div>
          </div>

          {/* Fee */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-sanctuary-500">Network Fee</span>
              {!isDraftMode && (
                <button
                  onClick={() => handleEdit('outputs')}
                  className="text-xs text-primary-600 hover:text-primary-700"
                >
                  Edit
                </button>
              )}
            </div>
            <div className="text-right">
              <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                {format(txData?.fee || estimatedFee)}
              </div>
              <div className="text-xs text-sanctuary-500">
                {state.feeRate} sat/vB
              </div>
            </div>
          </div>

          {/* Change (if any) */}
          {changeAmount > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-sanctuary-500">Change</span>
              <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                {format(changeAmount)}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
            <div className="flex justify-between items-center">
              <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Total (including fee)
              </span>
              <div className="text-right">
                <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-100">
                  {state.outputs.some(o => o.sendMax)
                    ? format(selectedTotal)
                    : format(totalOutputAmount + (txData?.fee || estimatedFee))
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Options Summary */}
      <div className="surface-secondary rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-sanctuary-500">RBF (Replace-By-Fee)</span>
          <span className="text-sanctuary-900 dark:text-sanctuary-100">
            {state.rbfEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {state.useDecoys && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-sanctuary-500">Decoy Outputs</span>
            <span className="text-sanctuary-900 dark:text-sanctuary-100">
              {state.decoyCount} decoys
            </span>
          </div>
        )}
        {state.showCoinControl && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-sanctuary-500">Coin Control</span>
            <span className="text-sanctuary-900 dark:text-sanctuary-100">
              {state.selectedUTXOs.size} UTXO{state.selectedUTXOs.size !== 1 ? 's' : ''} selected
            </span>
          </div>
        )}
      </div>

      {/* Multi-sig Signing Panel */}
      {isMultiSig && devices.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Signatures Required
            </h3>
            <span className="text-sm text-sanctuary-500">
              {signedDevices.size} of {requiredSignatures}
            </span>
          </div>

          {devices.map((device) => {
            const hasSigned = signedDevices.has(device.id);
            const capabilities = getDeviceCapabilities(device.type);

            return (
              <div
                key={device.id}
                className={`rounded-xl border transition-all ${
                  hasSigned
                    ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20'
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
                        <Usb className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
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
                  {hasSigned ? (
                    <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-500/20 rounded-lg">
                      <Check className="w-3 h-3 mr-1" />
                      Signed
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      {capabilities.methods.includes('usb') && (
                        <button
                          onClick={async () => {
                            if (onSignWithDevice) {
                              setSigningDeviceId(device.id);
                              try {
                                await onSignWithDevice(device);
                              } finally {
                                setSigningDeviceId(null);
                              }
                            } else {
                              onMarkDeviceSigned?.(device.id);
                            }
                          }}
                          disabled={signingDeviceId === device.id || signing}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          {signingDeviceId === device.id ? (
                            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                          ) : (
                            <Usb className="w-3 h-3 mr-1.5" />
                          )}
                          {signingDeviceId === device.id ? 'Signing...' : 'USB'}
                        </button>
                      )}
                      {capabilities.methods.includes('qr') && unsignedPsbt && (
                        <button
                          onClick={() => setQrSigningDevice(device)}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 rounded-lg transition-colors"
                        >
                          <QrCode className="w-3 h-3 mr-1.5" />
                          QR Code
                        </button>
                      )}
                      {capabilities.methods.includes('airgap') && (
                        <button
                          onClick={onDownloadPsbt}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-white dark:bg-sanctuary-800 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 border border-sanctuary-200 dark:border-sanctuary-600 rounded-lg transition-colors"
                        >
                          <FileDown className="w-3 h-3 mr-1.5" />
                          PSBT
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Signing panel for single-sig */}
      {!isMultiSig && (txData || unsignedPsbt) && (
        <div className="surface-secondary rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Sign Transaction
          </h3>
          <p className="text-xs text-sanctuary-500">
            Sign with your hardware wallet via USB or use air-gap signing with a PSBT file.
          </p>
          <div className="flex flex-wrap gap-2">
            {/* USB signing for single-sig - show button for each USB-capable device */}
            {devices.filter(d => {
              const caps = getDeviceCapabilities(d.type);
              return caps.methods.includes('usb');
            }).map(device => (
              <Button
                key={device.id}
                variant="primary"
                size="sm"
                onClick={async () => {
                  if (onSignWithDevice) {
                    setSigningDeviceId(device.id);
                    try {
                      await onSignWithDevice(device);
                    } finally {
                      setSigningDeviceId(null);
                    }
                  }
                }}
                disabled={signingDeviceId === device.id || signing}
              >
                {signingDeviceId === device.id ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Usb className="w-4 h-4 mr-2" />
                )}
                {signingDeviceId === device.id ? 'Signing...' : `Sign with ${device.label}`}
              </Button>
            ))}
            {/* QR signing for single-sig - show button for each QR-capable device */}
            {devices.filter(d => {
              const caps = getDeviceCapabilities(d.type);
              return caps.methods.includes('qr');
            }).map(device => (
              <Button
                key={`qr-${device.id}`}
                variant="primary"
                size="sm"
                onClick={() => setQrSigningDevice(device)}
                disabled={!unsignedPsbt}
              >
                <QrCode className="w-4 h-4 mr-2" />
                QR Sign ({device.label})
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={onDownloadPsbt}
            >
              <FileDown className="w-4 h-4 mr-2" />
              Download PSBT
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Signed
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".psbt,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          {signedDevices.has('psbt-signed') && (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              Signed PSBT uploaded
            </div>
          )}
        </div>
      )}

      {/* Validation Warnings */}
      {!isReadyToSign && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            Please complete all required fields before signing.
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3 pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
        {/* Primary Action */}
        <div className="flex gap-3">
          {!isDraftMode && (
            <Button
              variant="secondary"
              onClick={prevStep}
              className="flex-shrink-0"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}

          {isMultiSig ? (
            // Multi-sig: Show broadcast if enough signatures
            canBroadcast ? (
              <Button
                variant="primary"
                onClick={onBroadcastSigned}
                disabled={!canBroadcast}
                isLoading={broadcasting}
                className="flex-1"
              >
                <Send className="w-4 h-4 mr-2" />
                Broadcast Transaction
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={onSign}
                disabled={!isReadyToSign || !txData}
                isLoading={signing || broadcasting}
                className="flex-1"
              >
                {!txData ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 mr-2" />
                    Sign Transaction
                  </>
                )}
              </Button>
            )
          ) : (
            // Single-sig: Sign & Broadcast
            <Button
              variant="primary"
              onClick={onBroadcast}
              disabled={!isReadyToSign}
              isLoading={signing || broadcasting}
              className="flex-1"
            >
              {canBroadcast ? (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Broadcast
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Sign & Broadcast
                </>
              )}
            </Button>
          )}
        </div>

        {/* Save Draft Button */}
        {onSaveDraft && (
          <Button
            variant="secondary"
            onClick={onSaveDraft}
            isLoading={savingDraft}
            className="w-full"
          >
            <Save className="w-4 h-4 mr-2" />
            Save as Draft
          </Button>
        )}
      </div>

      {/* QR Signing Modal */}
      {qrSigningDevice && unsignedPsbt && (
        <QRSigningModal
          isOpen={true}
          onClose={() => setQrSigningDevice(null)}
          psbtBase64={unsignedPsbt}
          deviceLabel={qrSigningDevice.label}
          onSignedPsbt={(signedPsbt) => {
            onProcessQrSignedPsbt?.(signedPsbt, qrSigningDevice.id);
            setQrSigningDevice(null);
          }}
        />
      )}
    </div>
  );
}
