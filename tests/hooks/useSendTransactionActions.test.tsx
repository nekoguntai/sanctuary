/**
 * Tests for useSendTransactionActions hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';
import { useSendTransactionActions } from '../../hooks/useSendTransactionActions';
import * as transactionsApi from '../../src/api/transactions';
import * as draftsApi from '../../src/api/drafts';
import * as payjoinApi from '../../src/api/payjoin';
import type { Wallet, WalletType } from '../../types';
import type { TransactionState } from '../../contexts/send/types';

// Mock the APIs
vi.mock('../../src/api/transactions');
vi.mock('../../src/api/drafts');
vi.mock('../../src/api/payjoin');

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock hooks
vi.mock('../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
  }),
}));

vi.mock('../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: vi.fn(),
  }),
}));

vi.mock('../../hooks/useHardwareWallet', () => ({
  useHardwareWallet: () => ({
    isConnected: false,
    device: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signPSBT: vi.fn(),
  }),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
    formatFiat: () => null,
  }),
}));

// Test data
const mockWallet: Wallet = {
  id: 'test-wallet',
  name: 'Test Wallet',
  type: 'Single Sig' as WalletType,
  balance: 100000,
  scriptType: 'p2wpkh',
  derivationPath: "m/84'/0'/0'",
  fingerprint: 'abcd1234',
  label: 'Test Wallet',
  xpub: 'xpub...',
  unit: 'sats',
  ownerId: 'user1',
  groupIds: [],
  quorum: { m: 1, n: 1 },
  deviceIds: [],
};

const createMockState = (overrides: Partial<TransactionState> = {}): TransactionState => ({
  currentStep: 'review',
  completedSteps: new Set(['type', 'outputs']),
  transactionType: 'standard',
  outputs: [{ address: 'bc1qtest...', amount: '10000', sendMax: false }],
  outputsValid: [true],
  scanningOutputIndex: null,
  showCoinControl: false,
  selectedUTXOs: new Set(),
  feeRate: 10,
  rbfEnabled: true,
  subtractFees: false,
  useDecoys: false,
  decoyCount: 2,
  payjoinUrl: null,
  payjoinStatus: 'idle',
  signingDeviceId: null,
  expandedDeviceId: null,
  signedDevices: new Set(),
  unsignedPsbt: null,
  showPsbtOptions: false,
  psbtDeviceId: null,
  draftId: null,
  isDraftMode: false,
  isSubmitting: false,
  error: null,
  ...overrides,
});

const mockTxResult = {
  psbtBase64: 'cHNidP8BAH...',
  fee: 1500,
  totalInput: 50000,
  totalOutput: 48500,
  changeAmount: 38500,
  changeAddress: 'bc1qchange...',
  effectiveAmount: 10000,
  utxos: [{ txid: 'abc123', vout: 0 }],
  outputs: [{ address: 'bc1qtest...', amount: 10000 }],
  inputPaths: ["m/84'/0'/0'/0/0"],
};

// Wrapper for router context
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
);

describe('useSendTransactionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createTransaction', () => {
    it('should create a transaction with single output', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      let txData: any;
      await act(async () => {
        txData = await result.current.createTransaction();
      });

      expect(txData).not.toBeNull();
      expect(txData?.psbtBase64).toBe('cHNidP8BAH...');
      expect(result.current.unsignedPsbt).toBe('cHNidP8BAH...');
      expect(transactionsApi.createTransaction).toHaveBeenCalledWith('test-wallet', expect.objectContaining({
        recipient: 'bc1qtest...',
        amount: 10000,
        feeRate: 10,
      }));
    });

    it('should create batch transaction for multiple outputs', async () => {
      vi.mocked(transactionsApi.createBatchTransaction).mockResolvedValue(mockTxResult);

      const state = createMockState({
        outputs: [
          { address: 'bc1qaddr1...', amount: '5000', sendMax: false },
          { address: 'bc1qaddr2...', amount: '5000', sendMax: false },
        ],
        outputsValid: [true, true],
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(transactionsApi.createBatchTransaction).toHaveBeenCalled();
    });

    it('should validate outputs before creation', async () => {
      const state = createMockState({
        outputs: [{ address: '', amount: '10000', sendMax: false }],
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      let txData: any;
      await act(async () => {
        txData = await result.current.createTransaction();
      });

      expect(txData).toBeNull();
      expect(result.current.error).toContain('address');
    });

    it('should validate amount is greater than zero', async () => {
      const state = createMockState({
        outputs: [{ address: 'bc1qtest...', amount: '0', sendMax: false }],
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      let txData: any;
      await act(async () => {
        txData = await result.current.createTransaction();
      });

      expect(txData).toBeNull();
      expect(result.current.error).toContain('amount');
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(transactionsApi.createTransaction).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(result.current.error).toBe('Failed to create transaction');
    });

    it('should include decoy outputs in single transaction', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);

      const state = createMockState({
        useDecoys: true,
        decoyCount: 3,
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(transactionsApi.createTransaction).toHaveBeenCalledWith(
        'test-wallet',
        expect.objectContaining({
          decoyOutputs: { enabled: true, count: 3 },
        })
      );
    });
  });

  describe('broadcastTransaction', () => {
    it('should broadcast transaction with PSBT', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(transactionsApi.broadcastTransaction).mockResolvedValue({ txid: 'txid123' });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      // First create the transaction
      await act(async () => {
        await result.current.createTransaction();
      });

      // Then broadcast
      let success: boolean = false;
      await act(async () => {
        success = await result.current.broadcastTransaction('signed-psbt-base64');
      });

      expect(success).toBe(true);
      expect(transactionsApi.broadcastTransaction).toHaveBeenCalledWith(
        'test-wallet',
        expect.objectContaining({
          signedPsbtBase64: 'signed-psbt-base64',
        })
      );
      expect(mockNavigate).toHaveBeenCalledWith('/wallets/test-wallet');
    });

    it('should broadcast transaction with raw hex (Trezor path)', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(transactionsApi.broadcastTransaction).mockResolvedValue({ txid: 'txid123' });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      let success: boolean = false;
      await act(async () => {
        success = await result.current.broadcastTransaction(undefined, 'raw-tx-hex');
      });

      expect(success).toBe(true);
      expect(transactionsApi.broadcastTransaction).toHaveBeenCalledWith(
        'test-wallet',
        expect.objectContaining({
          rawTxHex: 'raw-tx-hex',
        })
      );
    });

    it('should handle broadcast errors', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(transactionsApi.broadcastTransaction).mockRejectedValue(new Error('Broadcast failed'));

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      let success: boolean = true;
      await act(async () => {
        success = await result.current.broadcastTransaction('signed-psbt');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Broadcast failed');
    });

    it('should delete draft after successful broadcast', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(transactionsApi.broadcastTransaction).mockResolvedValue({ txid: 'txid123' });
      vi.mocked(draftsApi.deleteDraft).mockResolvedValue(undefined);

      const state = createMockState({
        draftId: 'draft-123',
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      await act(async () => {
        await result.current.broadcastTransaction('signed-psbt');
      });

      expect(draftsApi.deleteDraft).toHaveBeenCalledWith('test-wallet', 'draft-123');
    });

    it('should require transaction data before broadcast', async () => {
      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      let success: boolean = true;
      await act(async () => {
        success = await result.current.broadcastTransaction('signed-psbt');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('No transaction to broadcast');
    });
  });

  describe('saveDraft', () => {
    it('should create new draft when no draftId exists', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(draftsApi.createDraft).mockResolvedValue({ id: 'new-draft-id' } as any);

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      let draftId: string | null = null;
      await act(async () => {
        draftId = await result.current.saveDraft('My Draft');
      });

      expect(draftId).toBe('new-draft-id');
      expect(draftsApi.createDraft).toHaveBeenCalledWith(
        'test-wallet',
        expect.objectContaining({
          label: 'My Draft',
        })
      );
    });

    it('should update existing draft when draftId exists', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(draftsApi.updateDraft).mockResolvedValue({} as any);

      const state = createMockState({
        draftId: 'existing-draft',
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      // Create transaction first so txData exists
      await act(async () => {
        await result.current.createTransaction();
      });

      let draftId: string | null = null;
      await act(async () => {
        draftId = await result.current.saveDraft();
      });

      expect(draftId).toBe('existing-draft');
      expect(draftsApi.updateDraft).toHaveBeenCalled();
    });

    it('should handle save errors', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(draftsApi.createDraft).mockRejectedValue(new Error('Save failed'));

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      let draftId: string | null = 'not-null';
      await act(async () => {
        draftId = await result.current.saveDraft();
      });

      expect(draftId).toBeNull();
      expect(result.current.error).toBe('Failed to save draft');
    });
  });

  describe('signWithDevice', () => {
    it('should handle unsupported device types', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      let success: boolean = true;
      await act(async () => {
        success = await result.current.signWithDevice({
          id: 'dev1',
          type: 'unknown-device',
          label: 'Unknown',
          fingerprint: '12345678',
          wallets: [],
        });
      });

      expect(success).toBe(false);
      expect(result.current.error).toContain('Unsupported device type');
    });

    it('should reject air-gapped devices for USB signing', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      let success: boolean = true;
      await act(async () => {
        success = await result.current.signWithDevice({
          id: 'dev1',
          type: 'coldcard',
          label: 'Coldcard',
          fingerprint: '12345678',
          wallets: [],
        });
      });

      expect(success).toBe(false);
      expect(result.current.error).toContain('USB signing');
    });
  });

  describe('state management', () => {
    it('should track loading states', async () => {
      vi.mocked(transactionsApi.createTransaction).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockTxResult), 100))
      );

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      expect(result.current.isCreating).toBe(false);

      act(() => {
        result.current.createTransaction();
      });

      expect(result.current.isCreating).toBe(true);

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });
    });

    it('should clear error when clearError is called', async () => {
      vi.mocked(transactionsApi.createTransaction).mockRejectedValue(new Error('Test error'));

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(result.current.error).toBe('Failed to create transaction');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('should reset all state when reset is called', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(result.current.txData).not.toBeNull();

      act(() => {
        result.current.reset();
      });

      expect(result.current.txData).toBeNull();
      expect(result.current.unsignedPsbt).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.signedDevices.size).toBe(0);
    });
  });

  describe('payjoin', () => {
    it('should attempt payjoin when URL is present', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(payjoinApi.attemptPayjoin).mockResolvedValue({
        success: true,
        proposalPsbt: 'payjoin-psbt',
        isPayjoin: true,
      });

      const state = createMockState({
        payjoinUrl: 'https://example.com/payjoin',
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(payjoinApi.attemptPayjoin).toHaveBeenCalled();
      expect(result.current.payjoinStatus).toBe('success');
      expect(result.current.unsignedPsbt).toBe('payjoin-psbt');
    });

    it('should fallback to regular transaction when payjoin fails', async () => {
      vi.mocked(transactionsApi.createTransaction).mockResolvedValue(mockTxResult);
      vi.mocked(payjoinApi.attemptPayjoin).mockResolvedValue({
        success: false,
        error: 'Payjoin server unavailable',
        isPayjoin: false,
      });

      const state = createMockState({
        payjoinUrl: 'https://example.com/payjoin',
      });

      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state,
        }),
        { wrapper }
      );

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(result.current.payjoinStatus).toBe('failed');
      expect(result.current.unsignedPsbt).toBe('cHNidP8BAH...'); // Original PSBT
    });
  });

  describe('markDeviceSigned', () => {
    it('should add device to signedDevices set', () => {
      const { result } = renderHook(
        () => useSendTransactionActions({
          walletId: 'test-wallet',
          wallet: mockWallet,
          state: createMockState(),
        }),
        { wrapper }
      );

      expect(result.current.signedDevices.size).toBe(0);

      act(() => {
        result.current.markDeviceSigned('device-1');
      });

      expect(result.current.signedDevices.has('device-1')).toBe(true);

      act(() => {
        result.current.markDeviceSigned('device-2');
      });

      expect(result.current.signedDevices.size).toBe(2);
    });
  });
});
