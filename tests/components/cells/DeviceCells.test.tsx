import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDeviceCellRenderers, type DeviceWithWallets } from '../../../components/cells/DeviceCells';
import type { TableColumnConfig } from '../../../types';

vi.mock('lucide-react', () => ({
  Edit2: () => <span data-testid="edit-icon" />,
  Save: () => <span data-testid="save-icon" />,
  X: () => <span data-testid="x-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  Users: () => <span data-testid="users-icon" />,
  HardDrive: () => <span data-testid="drive-icon" />,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: (_name: string, _className?: string) => <span data-testid="device-icon" />,
  getWalletIcon: (_type: string, _className?: string) => <span data-testid="wallet-icon" />,
}));

const baseColumn: TableColumnConfig = { id: 'label', label: 'Label' };

const baseDevice: DeviceWithWallets = {
  id: 'device-1',
  type: 'passport',
  label: 'Passport',
  fingerprint: 'abcd1234',
  isOwner: true,
  accounts: [],
  wallets: [],
};

describe('DeviceCells', () => {
  it('renders editable label cell and triggers save', async () => {
    const user = userEvent.setup();
    const handleSave = vi.fn();

    const renderers = createDeviceCellRenderers(
      {
        editingId: 'device-1',
        editValue: 'My Device',
        editType: 'passport',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave,
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [{ slug: 'passport', manufacturer: 'Foundation', name: 'Passport' }],
      }
    );

    render(<renderers.label item={baseDevice} column={baseColumn} />);

    expect(screen.getByDisplayValue('My Device')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Save device'));
    expect(handleSave).toHaveBeenCalledWith(baseDevice);
  });

  it('shows edit button for owner and triggers edit', async () => {
    const user = userEvent.setup();
    const handleEdit = vi.fn();

    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit,
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(<renderers.label item={baseDevice} column={baseColumn} />);
    await user.click(screen.getByTestId('edit-icon'));
    expect(handleEdit).toHaveBeenCalledWith(baseDevice);
  });

  it('shows shared by label for non-owner', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(
      <renderers.label
        item={{ ...baseDevice, isOwner: false, sharedBy: 'alice' }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('Shared by alice')).toBeInTheDocument();
  });

  it('renders accounts fallback and none states', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { rerender } = render(
      <renderers.accounts
        item={{ ...baseDevice, accounts: [], derivationPath: "m/48'/0'/0'/2'" }}
        column={baseColumn}
      />
    );
    expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();

    rerender(<renderers.accounts item={{ ...baseDevice, accounts: [] }} column={baseColumn} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders wallets fallback and count badge', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { rerender } = render(
      <renderers.wallets item={{ ...baseDevice, walletCount: 0 }} column={baseColumn} />
    );
    expect(screen.getByText('Unused')).toBeInTheDocument();

    rerender(
      <renderers.wallets item={{ ...baseDevice, walletCount: 2, wallets: [] }} column={baseColumn} />
    );
    expect(screen.getByText('2 wallets')).toBeInTheDocument();
  });

  it('handles delete confirmation flow', async () => {
    const user = userEvent.setup();
    const handleDelete = vi.fn();
    const setDeleteConfirmId = vi.fn();
    const setDeleteError = vi.fn();

    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId,
        setDeleteError,
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete,
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(<renderers.actions item={baseDevice} column={baseColumn} />);

    await user.click(screen.getByTitle('Delete device'));
    expect(setDeleteConfirmId).toHaveBeenCalledWith('device-1');

    // Confirm UI
    const renderersConfirm = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: 'device-1',
        deleteError: null,
        setDeleteConfirmId,
        setDeleteError,
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete,
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(<renderersConfirm.actions item={baseDevice} column={baseColumn} />);
    await user.click(screen.getByText('Yes'));
    expect(handleDelete).toHaveBeenCalledWith(baseDevice);

    await user.click(screen.getByText('No'));
    expect(setDeleteConfirmId).toHaveBeenCalledWith(null);
    expect(setDeleteError).toHaveBeenCalledWith(null);
  });
});
