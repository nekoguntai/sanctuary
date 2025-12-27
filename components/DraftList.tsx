import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Download,
  Upload,
  Trash2,
  Play,
  AlertCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { DraftTransaction, getDrafts, deleteDraft, updateDraft } from '../src/api/drafts';
import { TransactionFlowPreview, FlowInput, FlowOutput } from './TransactionFlowPreview';
import { WalletType } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import { createLogger } from '../utils/logger';
import { truncateAddress } from '../utils/formatters';

const log = createLogger('DraftList');

// Expiration urgency levels
type ExpirationUrgency = 'normal' | 'warning' | 'critical' | 'expired';

interface ExpirationInfo {
  text: string;
  urgency: ExpirationUrgency;
  diffMs: number;
}

/**
 * Calculate expiration info for a draft
 */
const getExpirationInfo = (expiresAt: string | undefined): ExpirationInfo | null => {
  if (!expiresAt) return null;

  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { text: 'Expired', urgency: 'expired', diffMs };
  }

  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 60) {
    return { text: `Expires in ${diffMin}m`, urgency: 'critical', diffMs };
  }
  if (diffHour < 24) {
    return { text: `Expires in ${diffHour}h`, urgency: 'critical', diffMs };
  }
  if (diffHour < 48) {
    return { text: 'Expires tomorrow', urgency: 'warning', diffMs };
  }
  if (diffDay <= 2) {
    return { text: `Expires in ${diffDay} days`, urgency: 'warning', diffMs };
  }
  return { text: `Expires in ${diffDay} days`, urgency: 'normal', diffMs };
};

interface WalletAddressInfo {
  address: string;
}

interface DraftListProps {
  walletId: string;
  walletType: WalletType;
  quorum?: { m: number; n: number };
  onResume?: (draft: DraftTransaction) => void;
  canEdit?: boolean;
  onDraftsChange?: (count: number) => void;
  walletAddresses?: WalletAddressInfo[];
  walletName?: string;
}

export const DraftList: React.FC<DraftListProps> = ({
  walletId,
  walletType,
  quorum,
  onResume,
  canEdit = true,
  onDraftsChange,
  walletAddresses = [],
  walletName,
}) => {
  const navigate = useNavigate();
  const { format } = useCurrency();

  // Create a set of known wallet addresses for quick lookup
  const knownAddresses = React.useMemo(() => {
    return new Set(walletAddresses.map(wa => wa.address));
  }, [walletAddresses]);

  // Helper to get label for an address if it belongs to our wallet
  const getAddressLabel = React.useCallback((address: string): string | undefined => {
    if (knownAddresses.has(address)) {
      return walletName || 'Own wallet';
    }
    return undefined;
  }, [knownAddresses, walletName]);
  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);

  // Calculate fee warning for a draft
  const getFeeWarning = (draft: DraftTransaction) => {
    const fee = draft.fee;
    const sendAmount = draft.effectiveAmount;

    if (sendAmount <= 0 || fee <= 0) return null;

    const feePercent = (fee / sendAmount) * 100;

    if (feePercent >= 50) {
      return { level: 'critical', percent: feePercent, message: 'Fee is more than half of the amount!' };
    } else if (feePercent >= 25) {
      return { level: 'critical', percent: feePercent, message: 'Fee is more than 25% of the amount' };
    } else if (feePercent >= 10) {
      return { level: 'warning', percent: feePercent, message: 'Fee is more than 10% of the amount' };
    }
    return null;
  };

  // Build flow preview data from draft
  const getFlowPreviewData = (draft: DraftTransaction) => {
    // Use individual inputs if available, otherwise create a summary input
    let inputs: FlowInput[];
    if (draft.inputs && draft.inputs.length > 0) {
      inputs = draft.inputs.map(input => ({
        txid: input.txid,
        vout: input.vout,
        address: input.address,
        amount: input.amount,
        label: getAddressLabel(input.address),
      }));
    } else {
      // Fallback: create a summary input
      inputs = [{
        txid: 'inputs',
        vout: 0,
        address: `${draft.selectedUtxoIds?.length || 1} input${(draft.selectedUtxoIds?.length || 1) !== 1 ? 's' : ''}`,
        amount: draft.totalInput,
      }];
    }

    // Build outputs from draft data
    const flowOutputs: FlowOutput[] = [];

    if (draft.outputs && draft.outputs.length > 0) {
      draft.outputs.forEach((output) => {
        flowOutputs.push({
          address: output.address,
          amount: output.sendMax ? draft.effectiveAmount : output.amount,
          isChange: false,
          label: getAddressLabel(output.address),
        });
      });
    } else {
      // Fallback to single recipient
      flowOutputs.push({
        address: draft.recipient,
        amount: draft.effectiveAmount,
        isChange: false,
        label: getAddressLabel(draft.recipient),
      });
    }

    // Add decoy outputs if present (these are change outputs distributed for privacy)
    // Or add single change output if no decoys
    if (draft.decoyOutputs && draft.decoyOutputs.length > 0) {
      draft.decoyOutputs.forEach(decoy => {
        flowOutputs.push({
          address: decoy.address,
          amount: decoy.amount,
          isChange: true,
          label: getAddressLabel(decoy.address),
        });
      });
    } else if (draft.changeAmount > 0 && draft.changeAddress) {
      flowOutputs.push({
        address: draft.changeAddress,
        amount: draft.changeAmount,
        isChange: true,
        label: getAddressLabel(draft.changeAddress),
      });
    }

    return {
      inputs,
      outputs: flowOutputs,
      fee: draft.fee,
      feeRate: draft.feeRate,
      totalInput: draft.totalInput,
      totalOutput: draft.totalOutput,
    };
  };

  useEffect(() => {
    loadDrafts();
  }, [walletId]);

  const loadDrafts = async () => {
    try {
      setLoading(true);
      setError(null);
      log.debug('Loading drafts for wallet', { walletId });
      const data = await getDrafts(walletId);
      log.debug('Loaded drafts', { count: data.length });
      setDrafts(data);
      onDraftsChange?.(data.length);
    } catch (err: any) {
      log.error('Failed to load drafts', { error: err });
      setError(err.message || 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  // Sort drafts: expired first (for visibility), then by expiration (soonest first), then by creation date
  const sortedDrafts = React.useMemo(() => {
    return [...drafts].sort((a, b) => {
      const aExp = getExpirationInfo(a.expiresAt);
      const bExp = getExpirationInfo(b.expiresAt);

      // If one has expiration and the other doesn't, prioritize the one with expiration
      if (aExp && !bExp) return -1;
      if (!aExp && bExp) return 1;
      if (!aExp && !bExp) {
        // Both without expiration - sort by creation date (newest first)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      // Both have expiration - sort by urgency then by time remaining
      const urgencyOrder: Record<ExpirationUrgency, number> = {
        expired: 0,
        critical: 1,
        warning: 2,
        normal: 3,
      };

      const aUrgency = urgencyOrder[aExp!.urgency];
      const bUrgency = urgencyOrder[bExp!.urgency];

      if (aUrgency !== bUrgency) {
        return aUrgency - bUrgency;
      }

      // Same urgency - sort by time remaining (soonest first)
      return aExp!.diffMs - bExp!.diffMs;
    });
  }, [drafts]);

  const handleResume = (draft: DraftTransaction) => {
    if (onResume) {
      onResume(draft);
    } else {
      // Navigate to send page with draft data
      navigate(`/wallets/${walletId}/send`, { state: { draft } });
    }
  };

  const handleDelete = async (draftId: string) => {
    try {
      await deleteDraft(walletId, draftId);
      const newDrafts = drafts.filter(d => d.id !== draftId);
      setDrafts(newDrafts);
      setDeleteConfirm(null);
      onDraftsChange?.(newDrafts.length);
    } catch (err: any) {
      log.error('Failed to delete draft', { error: err });
      setError(err.message || 'Failed to delete draft');
    }
  };

  const handleDownloadPsbt = (draft: DraftTransaction) => {
    const psbtToDownload = draft.signedPsbtBase64 || draft.psbtBase64;
    // Convert base64 to binary (BIP 174 standard format for .psbt files)
    const binaryString = atob(psbtToDownload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sanctuary-draft-${draft.id.slice(0, 8)}.psbt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUploadPsbt = async (draftId: string, file: File) => {
    try {
      const text = await file.text();
      const signedPsbt = text.trim();

      // Update the draft with the signed PSBT
      const draft = drafts.find(d => d.id === draftId);
      if (!draft) return;

      // Determine new status
      const isMultisig = walletType === WalletType.MULTI_SIG;
      const newStatus = isMultisig ? 'partial' : 'signed';

      await updateDraft(walletId, draftId, {
        signedPsbtBase64: signedPsbt,
        status: newStatus,
      });

      // Reload drafts to get updated data
      await loadDrafts();
      setUploadingFor(null);
    } catch (err: any) {
      log.error('Failed to upload PSBT', { error: err });
      setError(err.message || 'Failed to upload signed PSBT');
    }
  };

  const getStatusBadge = (draft: DraftTransaction) => {
    const isMultisig = walletType === WalletType.MULTI_SIG;

    switch (draft.status) {
      case 'unsigned':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400">
            <Clock className="w-3 h-3" />
            Unsigned
          </span>
        );
      case 'partial':
        const signedCount = draft.signedDeviceIds?.length || 0;
        const requiredSigs = quorum?.m || 1;
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
            <AlertTriangle className="w-3 h-3" />
            {signedCount} of {requiredSigs} signed
          </span>
        );
      case 'signed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
            <CheckCircle2 className="w-3 h-3" />
            Ready to broadcast
          </span>
        );
      default:
        return null;
    }
  };

  const getExpirationBadge = (draft: DraftTransaction) => {
    const expInfo = getExpirationInfo(draft.expiresAt);
    if (!expInfo) return null;

    switch (expInfo.urgency) {
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
      case 'normal':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs text-sanctuary-400 dark:text-sanctuary-500">
            <Clock className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
    }
  };

  const isExpired = (draft: DraftTransaction): boolean => {
    const expInfo = getExpirationInfo(draft.expiresAt);
    return expInfo?.urgency === 'expired';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Note: truncateAddress is now imported from utils/formatters

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center gap-2 text-sanctuary-400">
          <Clock className="w-5 h-5 animate-pulse" />
          Loading drafts...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center gap-2 text-red-500">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
        <button
          onClick={loadDrafts}
          className="mt-4 text-primary-600 hover:text-primary-700 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="text-center py-10">
        <FileText className="w-12 h-12 mx-auto text-sanctuary-300 dark:text-sanctuary-600 mb-4" />
        <p className="text-sanctuary-500 dark:text-sanctuary-400">No draft transactions</p>
        <p className="text-sm text-sanctuary-400 dark:text-sanctuary-500 mt-1">
          Create a transaction and save it as a draft to resume later
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Draft Transactions
        </h3>
        <span className="text-sm text-sanctuary-500">
          {drafts.length} draft{drafts.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {sortedDrafts.map((draft) => (
          <div
            key={draft.id}
            className={`surface-elevated rounded-xl p-4 border ${
              isExpired(draft)
                ? 'border-rose-300 dark:border-rose-800 opacity-75'
                : 'border-sanctuary-200 dark:border-sanctuary-700'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-xs text-sanctuary-400">
                    {formatDate(draft.createdAt)}
                  </span>
                  {getStatusBadge(draft)}
                  {getExpirationBadge(draft)}
                </div>

                <div className="mb-2">
                  <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
                    To:{' '}
                  </span>
                  {draft.outputs && draft.outputs.length > 0 ? (
                    draft.outputs.length === 1 ? (
                      <span className="font-mono text-sm text-sanctuary-700 dark:text-sanctuary-300">
                        {truncateAddress(draft.outputs[0].address)}
                      </span>
                    ) : (
                      <div className="mt-1 space-y-1">
                        {draft.outputs.map((output, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="font-mono text-sanctuary-700 dark:text-sanctuary-300">
                              {truncateAddress(output.address)}
                            </span>
                            <span className="ml-2 text-sanctuary-600 dark:text-sanctuary-400">
                              {output.sendMax ? 'MAX' : format(output.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    <span className="font-mono text-sm text-sanctuary-700 dark:text-sanctuary-300">
                      {truncateAddress(draft.recipient)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
                      Amount:{' '}
                    </span>
                    <Amount
                      sats={draft.effectiveAmount}
                      className="font-medium text-sanctuary-900 dark:text-sanctuary-100"
                    />
                  </div>
                  <div>
                    <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
                      Fee:{' '}
                    </span>
                    <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">
                      {draft.fee.toLocaleString()} sats ({draft.feeRate} sat/vB)
                    </span>
                  </div>
                </div>

                {/* Fee Warning */}
                {(() => {
                  const warning = getFeeWarning(draft);
                  if (!warning) return null;
                  return (
                    <div className={`mt-2 p-2 rounded-lg border flex items-center gap-2 ${
                      warning.level === 'critical'
                        ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    }`}>
                      <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${
                        warning.level === 'critical'
                          ? 'text-rose-500'
                          : 'text-amber-500'
                      }`} />
                      <span className={`text-sm ${
                        warning.level === 'critical'
                          ? 'text-rose-700 dark:text-rose-300'
                          : 'text-amber-700 dark:text-amber-300'
                      }`}>
                        {warning.message} ({warning.percent.toFixed(1)}%)
                      </span>
                    </div>
                  );
                })()}

                {draft.label && (
                  <div className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
                    Label: {draft.label}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {isExpired(draft) ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-sanctuary-300 dark:bg-sanctuary-700 text-sanctuary-500 dark:text-sanctuary-400 cursor-not-allowed">
                    <AlertCircle className="w-4 h-4" />
                    Expired
                  </span>
                ) : (
                  <button
                    onClick={() => handleResume(draft)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Resume
                  </button>
                )}

                <div className="flex gap-1">
                  <button
                    onClick={() => handleDownloadPsbt(draft)}
                    className="p-1.5 rounded-lg text-sanctuary-500 hover:text-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
                    title="Download PSBT"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  {canEdit && (
                    <>
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept=".psbt,.txt"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleUploadPsbt(draft.id, file);
                            }
                            e.target.value = '';
                          }}
                        />
                        <span
                          className="inline-flex p-1.5 rounded-lg text-sanctuary-500 hover:text-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
                          title="Upload signed PSBT"
                        >
                          <Upload className="w-4 h-4" />
                        </span>
                      </label>

                      {deleteConfirm === draft.id ? (
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleDelete(draft.id)}
                            className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(draft.id)}
                          className="p-1.5 rounded-lg text-sanctuary-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title="Delete draft"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Expand/Collapse Toggle */}
            <button
              onClick={() => setExpandedDraft(expandedDraft === draft.id ? null : draft.id)}
              className="w-full mt-3 pt-3 border-t border-sanctuary-200 dark:border-sanctuary-700 flex items-center justify-center gap-1 text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
            >
              {expandedDraft === draft.id ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  Hide Transaction Flow
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  Show Transaction Flow
                </>
              )}
            </button>

            {/* Transaction Flow Preview */}
            {expandedDraft === draft.id && (
              <div className="mt-4">
                <TransactionFlowPreview
                  inputs={getFlowPreviewData(draft).inputs}
                  outputs={getFlowPreviewData(draft).outputs}
                  fee={getFlowPreviewData(draft).fee}
                  feeRate={getFlowPreviewData(draft).feeRate}
                  totalInput={getFlowPreviewData(draft).totalInput}
                  totalOutput={getFlowPreviewData(draft).totalOutput}
                  isEstimate={false}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DraftList;
