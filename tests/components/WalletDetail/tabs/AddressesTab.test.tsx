import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddressesTab } from '../../../../components/WalletDetail/tabs/AddressesTab';

const copyMock = vi.fn();

vi.mock('../../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (value: number) => `${value} sats`,
  }),
}));

vi.mock('../../../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: copyMock,
    isCopied: () => false,
  }),
}));

describe('AddressesTab', () => {
  const baseProps = {
    addresses: [],
    addressSummary: {
      totalAddresses: 0,
      usedCount: 0,
      unusedCount: 0,
      totalBalance: 0,
      usedBalance: 0,
      unusedBalance: 0,
    },
    addressSubTab: 'receive' as const,
    onAddressSubTabChange: vi.fn(),
    descriptor: null,
    network: 'mainnet',
    loadingAddresses: false,
    hasMoreAddresses: false,
    onLoadMoreAddresses: vi.fn(),
    onGenerateMoreAddresses: vi.fn(),
    editingAddressId: null,
    availableLabels: [],
    selectedLabelIds: [],
    onEditAddressLabels: vi.fn(),
    onSaveAddressLabels: vi.fn(),
    onToggleAddressLabel: vi.fn(),
    savingAddressLabels: false,
    onCancelEditLabels: vi.fn(),
    onShowQrModal: vi.fn(),
    explorerUrl: 'https://mempool.space',
  };

  it('shows empty state without generate button when descriptor is missing', () => {
    render(<AddressesTab {...baseProps} />);
    expect(screen.getByText('No Addresses Available')).toBeInTheDocument();
    expect(screen.queryByText('Generate Addresses')).not.toBeInTheDocument();
  });

  it('shows generate button for wallets with descriptors', () => {
    render(<AddressesTab {...baseProps} descriptor="wpkh(...)" />);
    fireEvent.click(screen.getByText('Generate Addresses'));
    expect(baseProps.onGenerateMoreAddresses).toHaveBeenCalled();
  });

  it('renders address table actions and load-more control', () => {
    const addresses = [
      {
        id: 'addr-1',
        address: 'bc1qreceive000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
        balance: 10_000,
        labels: [],
      },
    ];

    render(
      <AddressesTab
        {...baseProps}
        addresses={addresses as any}
        descriptor="wpkh(...)"
        hasMoreAddresses
      />
    );

    fireEvent.click(screen.getByTitle('Copy address'));
    fireEvent.click(screen.getByTitle('Show QR code'));
    fireEvent.click(screen.getByText('Load More'));

    expect(copyMock).toHaveBeenCalled();
    expect(baseProps.onShowQrModal).toHaveBeenCalledWith(addresses[0].address);
    expect(baseProps.onLoadMoreAddresses).toHaveBeenCalled();
  });

  it('switches address sub-tabs', () => {
    const addresses = [
      {
        id: 'addr-1',
        address: 'bc1qreceive000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
        balance: 0,
        labels: [],
      },
    ];

    render(<AddressesTab {...baseProps} addresses={addresses as any} descriptor="wpkh(...)" />);
    fireEvent.click(screen.getByText('Change'));
    expect(baseProps.onAddressSubTabChange).toHaveBeenCalledWith('change');
  });
});
