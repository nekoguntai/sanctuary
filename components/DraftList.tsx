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
} from 'lucide-react';
import { DraftTransaction, getDrafts, deleteDraft, updateDraft } from '../src/api/drafts';
import { WalletType } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';

interface DraftListProps {
  walletId: string;
  walletType: WalletType;
  quorum?: { m: number; n: number };
  onResume?: (draft: DraftTransaction) => void;
  canEdit?: boolean;
  onDraftsChange?: (count: number) => void;
}

export const DraftList: React.FC<DraftListProps> = ({
  walletId,
  walletType,
  quorum,
  onResume,
  canEdit = true,
  onDraftsChange,
}) => {
  const navigate = useNavigate();
  const { format } = useCurrency();
  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  useEffect(() => {
    loadDrafts();
  }, [walletId]);

  const loadDrafts = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[DraftList] Loading drafts for wallet:', walletId);
      const data = await getDrafts(walletId);
      console.log('[DraftList] Loaded drafts:', data.length, data);
      setDrafts(data);
      onDraftsChange?.(data.length);
    } catch (err: any) {
      console.error('[DraftList] Failed to load drafts:', err);
      setError(err.message || 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

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
      console.error('Failed to delete draft:', err);
      setError(err.message || 'Failed to delete draft');
    }
  };

  const handleDownloadPsbt = (draft: DraftTransaction) => {
    const psbtToDownload = draft.signedPsbtBase64 || draft.psbtBase64;
    const blob = new Blob([psbtToDownload], { type: 'text/plain' });
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
      console.error('Failed to upload PSBT:', err);
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const truncateAddress = (address: string) => {
    if (address.length <= 20) return address;
    return `${address.slice(0, 10)}...${address.slice(-8)}`;
  };

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
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className="surface-elevated rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-sanctuary-400">
                    {formatDate(draft.createdAt)}
                  </span>
                  {getStatusBadge(draft)}
                </div>

                <div className="mb-2">
                  <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
                    To:{' '}
                  </span>
                  <span className="font-mono text-sm text-sanctuary-700 dark:text-sanctuary-300">
                    {truncateAddress(draft.recipient)}
                  </span>
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

                {draft.label && (
                  <div className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
                    Label: {draft.label}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleResume(draft)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Resume
                </button>

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
          </div>
        ))}
      </div>
    </div>
  );
};

export default DraftList;
