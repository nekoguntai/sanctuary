/**
 * SendTransactionPage Component
 *
 * Page wrapper that handles data fetching and renders the SendTransactionWizard.
 * Replaces the monolithic SendTransaction.tsx with a cleaner separation of concerns.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { SendTransactionWizard } from './SendTransactionWizard';
import { Wallet, UTXO, FeeEstimate, WalletType, Device } from '../../types';
import { getQuorumM, getQuorumN } from '../../types';
import * as walletsApi from '../../src/api/wallets';
import * as transactionsApi from '../../src/api/transactions';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as devicesApi from '../../src/api/devices';
import type { DraftTransaction } from '../../src/api/drafts';
import { ApiError } from '../../src/api/client';
import { useUser } from '../../contexts/UserContext';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { createLogger } from '../../utils/logger';
import type { BlockData, QueuedBlocksSummary } from '../../src/api/bitcoin';
import type { SerializableTransactionState, WalletAddress } from '../../contexts/send/types';

const log = createLogger('SendTxPage');

export const SendTransactionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { showInfo } = useErrorHandler();

  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data from APIs
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [utxos, setUTXOs] = useState<UTXO[]>([]);
  const [fees, setFees] = useState<FeeEstimate | null>(null);
  const [mempoolBlocks, setMempoolBlocks] = useState<BlockData[]>([]);
  const [queuedBlocksSummary, setQueuedBlocksSummary] = useState<QueuedBlocksSummary | null>(null);
  const [walletAddresses, setWalletAddresses] = useState<WalletAddress[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  // Initial state from draft or pre-selection
  const [initialState, setInitialState] = useState<Partial<SerializableTransactionState> | undefined>(undefined);
  const [draftTxData, setDraftTxData] = useState<{
    fee: number;
    totalInput: number;
    totalOutput: number;
    changeAmount: number;
    changeAddress?: string;
    effectiveAmount: number;
    selectedUtxoIds: string[];
    inputPaths?: string[];
  } | undefined>(undefined);

  // Get draft data from location state
  const draftData = (location.state as { draft?: DraftTransaction })?.draft;
  const preSelectedUTXOs = (location.state as { preSelected?: string[] })?.preSelected;

  // Fetch all required data
  useEffect(() => {
    const fetchData = async () => {
      if (!id || !user) return;

      setLoading(true);
      setError(null);

      try {
        // Fetch wallet data first (critical)
        const apiWallet = await walletsApi.getWallet(id);

        // Convert API wallet to Wallet type
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
          quorum: {
            m: getQuorumM(apiWallet.quorum, 1),
            n: getQuorumN(apiWallet.quorum, apiWallet.totalSigners, 1),
          },
          descriptor: apiWallet.descriptor,
          deviceIds: [],
        };
        setWallet(formattedWallet);

        // Fetch all other data in parallel
        const [utxoData, feeEstimates, mempoolData, addressData, allDevices] = await Promise.all([
          transactionsApi.getUTXOs(id),
          bitcoinApi.getFeeEstimates(),
          bitcoinApi.getMempoolData().catch(() => null),
          transactionsApi.getAddresses(id).catch(() => []),
          devicesApi.getDevices().catch(() => []),
        ]);

        // Format UTXOs
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

        // Format fees
        const formattedFees: FeeEstimate = {
          fastestFee: feeEstimates.fastest,
          halfHourFee: feeEstimates.hour,
          hourFee: feeEstimates.economy,
          economyFee: feeEstimates.minimum || 1,
          minimumFee: feeEstimates.minimum || 1,
        };
        setFees(formattedFees);

        // Set mempool data
        if (mempoolData) {
          const allBlocks = [...mempoolData.mempool, ...mempoolData.blocks];
          setMempoolBlocks(allBlocks);
          setQueuedBlocksSummary(mempoolData.queuedBlocksSummary || null);
        }

        // Set wallet addresses - include ALL addresses (receive and change) for label lookup
        if (addressData && addressData.length > 0) {
          const allAddresses: WalletAddress[] = addressData
            .map(addr => ({
              address: addr.address,
              used: addr.used,
              index: addr.index,
              isChange: addr.isChange,
            }));
          log.info('Wallet addresses loaded:', {
            count: allAddresses.length,
            sample: allAddresses.slice(0, 3).map(a => a.address.substring(0, 20) + '...'),
          });
          setWalletAddresses(allAddresses);
        } else {
          log.warn('No wallet addresses loaded for label lookup');
        }

        // Filter devices for this wallet
        log.info('Device filtering debug:', {
          walletId: id,
          totalDevices: allDevices.length,
          deviceDetails: allDevices.map(d => ({
            id: d.id,
            type: d.type,
            label: d.label,
            fingerprint: d.fingerprint,
            wallets: d.wallets?.map(w => ({ walletId: w.wallet?.id, walletName: w.wallet?.name })),
          })),
        });
        const walletDeviceList = allDevices.filter(d =>
          d.wallets?.some(w => w.wallet.id === id)
        );
        log.info('Filtered devices for wallet:', {
          walletId: id,
          matchedDevices: walletDeviceList.map(d => ({ id: d.id, type: d.type, label: d.label })),
        });
        setDevices(walletDeviceList);

        // Build initial state from draft or pre-selection
        const frozenUtxoIds = new Set(
          formattedUTXOs.filter(u => u.frozen).map(u => `${u.txid}:${u.vout}`)
        );

        if (draftData) {
          log.info('Loading draft data:', {
            draftId: draftData.id,
            hasPsbtBase64: !!draftData.psbtBase64,
            hasSignedPsbtBase64: !!draftData.signedPsbtBase64,
            psbtLength: (draftData.signedPsbtBase64 || draftData.psbtBase64)?.length,
            outputCount: draftData.outputs?.length ?? 1,
            recipient: draftData.recipient?.substring(0, 20) + '...',
          });
          // Resume from draft - go directly to review (PSBT is already created)
          // All parameters are locked since the PSBT can't be modified
          const draftInitial: Partial<SerializableTransactionState> = {
            currentStep: 'review',
            completedSteps: ['type', 'outputs'],
            isDraftMode: true,
            feeRate: draftData.feeRate,
            rbfEnabled: draftData.enableRBF,
            subtractFees: draftData.subtractFees,
            draftId: draftData.id,
            // Pass the PSBT for signing
            unsignedPsbt: draftData.signedPsbtBase64 || draftData.psbtBase64,
            // Pass signed devices if any
            signedDevices: draftData.signedDeviceIds || [],
            // Restore payjoin URL to allow re-attempt if previously failed
            payjoinUrl: draftData.payjoinUrl || null,
            payjoinStatus: 'idle', // Reset status to allow re-attempt
            outputs: draftData.outputs && draftData.outputs.length > 0
              ? draftData.outputs.map(o => ({
                  address: o.address,
                  amount: o.amount.toString(),
                  sendMax: false,
                }))
              : [{
                  address: draftData.recipient,
                  amount: draftData.amount.toString(),
                  sendMax: false,
                }],
          };

          // Handle selected UTXOs from draft
          if (draftData.selectedUtxoIds && draftData.selectedUtxoIds.length > 0) {
            // Include UTXOs that are spendable OR locked by this specific draft
            const availableUtxoIds = new Set(
              formattedUTXOs
                .filter(u => (u.spendable && !u.frozen) || u.lockedByDraftId === draftData.id)
                .map(u => `${u.txid}:${u.vout}`)
            );
            const validUtxoIds = draftData.isRBF
              ? draftData.selectedUtxoIds
              : draftData.selectedUtxoIds.filter(utxoId => availableUtxoIds.has(utxoId));

            if (validUtxoIds.length > 0) {
              draftInitial.selectedUTXOs = validUtxoIds;
              draftInitial.showCoinControl = true;
            }

            if (validUtxoIds.length !== draftData.selectedUtxoIds.length && !draftData.isRBF) {
              showInfo(`${draftData.selectedUtxoIds.length - validUtxoIds.length} UTXOs are no longer available`);
            }
          }

          // Check if this is a consolidation or standard transaction
          const allAddresses = addressData?.map(a => a.address) || [];
          if (allAddresses.includes(draftData.recipient)) {
            draftInitial.transactionType = 'consolidation';
          } else {
            draftInitial.transactionType = 'standard';
          }

          // Set outputsValid to true for all outputs (PSBT was already validated)
          const draftOutputs = draftInitial.outputs || [];
          draftInitial.outputsValid = draftOutputs.map(() => true);

          setInitialState(draftInitial);

          // Set transaction data from draft for review step
          setDraftTxData({
            fee: draftData.fee,
            totalInput: draftData.totalInput,
            totalOutput: draftData.totalOutput,
            changeAmount: draftData.changeAmount,
            changeAddress: draftData.changeAddress,
            effectiveAmount: draftData.effectiveAmount,
            selectedUtxoIds: draftData.selectedUtxoIds,
            inputPaths: draftData.inputPaths,
          });
        } else if (preSelectedUTXOs && preSelectedUTXOs.length > 0) {
          // Handle pre-selected UTXOs from wallet view
          const validPre = preSelectedUTXOs.filter(utxoId => !frozenUtxoIds.has(utxoId));
          if (validPre.length !== preSelectedUTXOs.length) {
            showInfo(`${preSelectedUTXOs.length - validPre.length} frozen UTXO${preSelectedUTXOs.length - validPre.length > 1 ? 's' : ''} removed from selection`);
          }
          if (validPre.length > 0) {
            setInitialState({
              selectedUTXOs: validPre,
              showCoinControl: true,
            });
          }
        }

        setLoading(false);
      } catch (err) {
        log.error('Failed to fetch data', { error: err });
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load transaction data');
        }
        setLoading(false);
      }
    };

    fetchData();
  }, [id, user, draftData, preSelectedUTXOs, showInfo]);

  // Cancel handler
  const handleCancel = useCallback(() => {
    navigate(`/wallets/${id}`);
  }, [navigate, id]);

  // Simple fee calculation function
  const calculateFee = useCallback((numInputs: number, numOutputs: number, rate: number): number => {
    // Estimate transaction size based on inputs/outputs
    // For P2WPKH: 10.5 + 68*inputs + 31*outputs (vbytes)
    const baseSize = 10.5;
    const inputSize = 68; // P2WPKH input
    const outputSize = 31; // P2WPKH output

    const vbytes = Math.ceil(baseSize + (inputSize * numInputs) + (outputSize * numOutputs));
    return Math.ceil(vbytes * rate);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-4" />
          <p className="text-sanctuary-500">Loading transaction data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !wallet) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Failed to Load
          </h2>
          <p className="text-sanctuary-500 mb-4">
            {error || 'Unable to load wallet data'}
          </p>
          <Button variant="primary" onClick={() => navigate(`/wallets/${id}`)}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <SendTransactionWizard
        wallet={wallet}
        devices={devices}
        utxos={utxos}
        walletAddresses={walletAddresses}
        fees={fees}
        mempoolBlocks={mempoolBlocks}
        queuedBlocksSummary={queuedBlocksSummary}
        initialState={initialState}
        draftTxData={draftTxData}
        calculateFee={calculateFee}
        onCancel={handleCancel}
      />
    </div>
  );
};
