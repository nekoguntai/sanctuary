import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewStep } from '../../../components/CreateWallet/ReviewStep';
import { WalletType } from '../../../types';

const devices = [
  { id: 'd1', label: 'Ledger One', type: 'ledger' },
  { id: 'd2', label: 'Coldcard Two', type: 'coldcard' },
] as any;

const renderStep = (overrides: Partial<React.ComponentProps<typeof ReviewStep>> = {}) =>
  render(
    <ReviewStep
      walletName="Branch Wallet"
      walletType={WalletType.SINGLE_SIG}
      network="mainnet"
      scriptType="native_segwit"
      quorumM={1}
      selectedDeviceIds={new Set(['d1'])}
      availableDevices={devices}
      {...overrides}
    />
  );

describe('CreateWallet ReviewStep branch coverage', () => {
  it('renders mainnet badge and single-sig script row', () => {
    const { container } = renderStep({
      network: 'mainnet',
      walletType: WalletType.SINGLE_SIG,
      scriptType: 'nested_segwit',
    });

    expect(screen.getByText('Mainnet')).toBeInTheDocument();
    expect(container.querySelector('.bg-mainnet-800')).toBeInTheDocument();
    expect(screen.getByText('Script')).toBeInTheDocument();
    expect(screen.getByText('nested segwit')).toBeInTheDocument();
    expect(screen.queryByText('Quorum')).not.toBeInTheDocument();
  });

  it('renders testnet badge and multisig quorum row', () => {
    const { container } = renderStep({
      network: 'testnet',
      walletType: WalletType.MULTI_SIG,
      quorumM: 2,
      selectedDeviceIds: new Set(['d1', 'd2']),
    });

    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(container.querySelector('.bg-testnet-800')).toBeInTheDocument();
    expect(screen.getByText('Quorum')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Script')).not.toBeInTheDocument();
  });

  it('renders else-branch network badge styling for signet', () => {
    const { container } = renderStep({
      network: 'signet',
    });

    expect(screen.getByText('Signet')).toBeInTheDocument();
    expect(container.querySelector('.bg-signet-800')).toBeInTheDocument();
  });
});
