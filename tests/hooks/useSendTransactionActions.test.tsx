import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSendTransactionActions } from '../../hooks/useSendTransactionActions';
import type { TransactionState } from '../../contexts/send/types';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
  }),
}));

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
    signPSBT: vi.fn(),
  }),
}));

vi.mock('../../src/api/transactions', () => ({
  createTransaction: vi.fn(),
}));

vi.mock('../../src/api/drafts', () => ({
  createDraft: vi.fn(),
}));

vi.mock('../../src/api/payjoin', () => ({
  createPayjoin: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const createState = (override?: Partial<TransactionState>): TransactionState => ({
  currentStep: 'outputs',
  completedSteps: new Set(['type']),
  transactionType: 'standard',
  outputs: [],
  outputsValid: [],
  scanningOutputIndex: null,
  showCoinControl: false,
  selectedUTXOs: new Set(),
  feeRate: 1,
  rbfEnabled: false,
  subtractFees: false,
  useDecoys: false,
  decoyCount: 0,
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
  ...override,
});

describe('useSendTransactionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates missing address', async () => {
    const state = createState({
      outputs: [{ address: '', amount: '1000', sendMax: false }],
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: { id: 'wallet-1', name: 'Wallet', type: 'single_sig', balance: 0 } as any,
        state,
      })
    );

    const response = await result.current.createTransaction();
    expect(response).toBeNull();

    await waitFor(() => {
      expect(result.current.error).toBe('Output 1: Please enter a recipient address');
    });
  });

  it('validates invalid amount', async () => {
    const state = createState({
      outputs: [{ address: 'bc1qvalid', amount: '0', sendMax: false }],
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: { id: 'wallet-1', name: 'Wallet', type: 'single_sig', balance: 0 } as any,
        state,
      })
    );

    const response = await result.current.createTransaction();
    expect(response).toBeNull();

    await waitFor(() => {
      expect(result.current.error).toBe('Output 1: Please enter a valid amount');
    });
  });
});
