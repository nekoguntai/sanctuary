import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportValidationResult } from '../../../src/api/wallets';
import { DeviceResolutionStep } from '../../../components/ImportWallet/DeviceResolution';

vi.mock('../../../components/ui/CustomIcons', () => ({
  SingleSigIcon: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="single-sig-icon" {...props} />
  ),
  MultiSigIcon: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="multi-sig-icon" {...props} />
  ),
  getDeviceIcon: vi.fn(() => <span data-testid="device-icon" />),
}));

vi.mock('lucide-react', () => ({
  CheckCircle: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="check-circle-icon" {...props} />
  ),
  PlusCircle: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="plus-circle-icon" {...props} />
  ),
  RefreshCw: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="refresh-icon" {...props} />
  ),
}));

const makeValidationResult = (
  overrides: Partial<ImportValidationResult> = {}
): ImportValidationResult => ({
  valid: true,
  format: 'descriptor',
  walletType: 'multi_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  quorum: 2,
  totalSigners: 3,
  devices: [
    {
      fingerprint: 'abcd1234',
      xpub: 'xpub-reused',
      derivationPath: "m/48'/0'/0'/2'",
      existingDeviceId: 'dev-1',
      existingDeviceLabel: 'Existing Ledger',
      willCreate: false,
      originalType: 'ledger',
    },
    {
      fingerprint: 'dcba4321',
      xpub: 'xpub-new',
      derivationPath: "m/48'/0'/0'/2'",
      existingDeviceId: null,
      existingDeviceLabel: null,
      willCreate: true,
      suggestedLabel: 'New Keystone',
      originalType: 'keystone',
    },
  ],
  ...overrides,
});

interface RenderOptions {
  validationResult?: ImportValidationResult;
  walletName?: string;
  network?: 'mainnet' | 'testnet' | 'regtest';
}

const renderStep = ({
  validationResult = makeValidationResult(),
  walletName = 'Imported Wallet',
  network = 'mainnet',
}: RenderOptions = {}) => {
  const setWalletName = vi.fn();
  const setNetwork = vi.fn();
  render(
    <DeviceResolutionStep
      validationResult={validationResult}
      walletName={walletName}
      setWalletName={setWalletName}
      network={network}
      setNetwork={setNetwork}
    />
  );
  return { setWalletName, setNetwork };
};

describe('DeviceResolutionStep', () => {
  it('renders multisig wallet info and both device action groups', () => {
    renderStep();

    expect(screen.getByText('Configure Import')).toBeInTheDocument();
    expect(screen.getByText('2-of-3 Multisig')).toBeInTheDocument();
    expect(screen.getByText('native segwit')).toBeInTheDocument();
    expect(screen.getByTestId('multi-sig-icon')).toBeInTheDocument();

    expect(screen.getByText('Will reuse existing devices:')).toBeInTheDocument();
    expect(screen.getByText('Will create new devices:')).toBeInTheDocument();
    expect(screen.getByText('Existing Ledger')).toBeInTheDocument();
    expect(screen.getByText('New Keystone')).toBeInTheDocument();
    expect(screen.getByTestId('refresh-icon')).toBeInTheDocument();
    expect(screen.getByTestId('check-circle-icon')).toBeInTheDocument();
    expect(screen.getAllByTestId('plus-circle-icon').length).toBeGreaterThan(1);
  });

  it('renders single-sig summary and fallback new-device label', () => {
    const result = makeValidationResult({
      walletType: 'single_sig',
      devices: [
        {
          fingerprint: 'ffffeeee',
          xpub: 'xpub-only',
          derivationPath: "m/84'/0'/0'",
          existingDeviceId: null,
          existingDeviceLabel: null,
          willCreate: true,
          suggestedLabel: undefined,
          originalType: 'unknown',
        },
      ],
    });

    renderStep({ validationResult: result });

    expect(screen.getByText('Single Signature')).toBeInTheDocument();
    expect(screen.getByTestId('single-sig-icon')).toBeInTheDocument();
    expect(screen.getByText('New Device')).toBeInTheDocument();
    expect(screen.queryByText('Will reuse existing devices:')).not.toBeInTheDocument();
  });

  it('updates wallet name and allows selecting network buttons', async () => {
    const user = userEvent.setup();
    const { setWalletName, setNetwork } = renderStep({ network: 'mainnet' });

    const input = screen.getByPlaceholderText('e.g., Imported Multisig');
    await user.clear(input);
    await user.type(input, 'Vault 2');
    expect(setWalletName).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Testnet' }));
    await user.click(screen.getByRole('button', { name: 'Regtest' }));
    expect(setNetwork).toHaveBeenCalledWith('testnet');
    expect(setNetwork).toHaveBeenCalledWith('regtest');
  });

  it.each([
    ['mainnet', 'Mainnet', 'border-mainnet-500'],
    ['testnet', 'Testnet', 'border-testnet-500'],
    ['regtest', 'Regtest', 'border-signet-500'],
  ] as const)(
    'applies active network styling for %s',
    (network, buttonName, activeClass) => {
      renderStep({ network });

      expect(screen.getByRole('button', { name: buttonName })).toHaveClass(activeClass);
      // Ensure inactive buttons use the shared inactive class branch.
      const inactive = ['Mainnet', 'Testnet', 'Regtest'].filter(name => name !== buttonName);
      for (const name of inactive) {
        expect(screen.getByRole('button', { name })).toHaveClass('border-sanctuary-200');
      }
    }
  );

  it('shows detected network label from validation result', () => {
    renderStep({ validationResult: makeValidationResult({ network: 'signet' }) });
    expect(screen.getByText('Detected: signet')).toBeInTheDocument();
  });
});
