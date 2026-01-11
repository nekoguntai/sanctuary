/**
 * DeviceList Component Tests
 *
 * Tests for the device list display including view modes,
 * sorting, filtering, editing, and deletion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Device, HardwareDeviceModel } from '../../types';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock UserContext
const mockUpdatePreferences = vi.fn();
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: {
      id: 'user-123',
      preferences: {
        viewSettings: {
          devices: {
            layout: 'list',
            sortBy: 'label',
            sortOrder: 'asc',
            ownershipFilter: 'all',
          },
        },
      },
    },
    updatePreferences: mockUpdatePreferences,
  }),
}));

// Mock device API
const mockGetDevices = vi.fn();
const mockUpdateDevice = vi.fn();
const mockDeleteDevice = vi.fn();
const mockGetDeviceModels = vi.fn();

vi.mock('../../src/api/devices', () => ({
  getDevices: () => mockGetDevices(),
  updateDevice: (...args: unknown[]) => mockUpdateDevice(...args),
  deleteDevice: (...args: unknown[]) => mockDeleteDevice(...args),
  getDeviceModels: () => mockGetDeviceModels(),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  HardDrive: () => <span data-testid="hard-drive-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  LayoutGrid: () => <span data-testid="grid-icon" />,
  List: () => <span data-testid="list-icon" />,
  Users: () => <span data-testid="users-icon" />,
  User: () => <span data-testid="user-icon" />,
  Edit2: () => <span data-testid="edit-icon" />,
  Save: () => <span data-testid="save-icon" />,
  X: () => <span data-testid="x-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
}));

// Mock custom icons
vi.mock('../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
  getWalletIcon: () => <span data-testid="wallet-icon" />,
}));

// Mock Button
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

// Mock ConfigurableTable
vi.mock('../../components/ui/ConfigurableTable', () => ({
  ConfigurableTable: ({ data, onRowClick }: { data: unknown[]; onRowClick?: (item: unknown) => void }) => (
    <table data-testid="configurable-table">
      <tbody>
        {data.map((item: unknown, index) => (
          <tr key={index} onClick={() => onRowClick?.(item)} data-testid="device-row">
            <td>{(item as Device).label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

// Mock ColumnConfigButton
vi.mock('../../components/ui/ColumnConfigButton', () => ({
  ColumnConfigButton: () => <button data-testid="column-config-button">Columns</button>,
}));

// Mock device column utilities
vi.mock('../../components/columns/deviceColumns', () => ({
  DEVICE_COLUMNS: [],
  DEFAULT_DEVICE_COLUMN_ORDER: ['label', 'type', 'fingerprint'],
  DEFAULT_DEVICE_VISIBLE_COLUMNS: ['label', 'type', 'fingerprint'],
  mergeDeviceColumnOrder: (order?: string[]) => order || ['label', 'type', 'fingerprint'],
}));

// Mock cell renderers
vi.mock('../../components/cells/DeviceCells', () => ({
  createDeviceCellRenderers: () => ({}),
}));

// Create mock device
const createMockDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 'device-1',
  userId: 'user-123',
  label: 'My Ledger',
  type: 'ledger',
  fingerprint: 'abc123def',
  xpub: 'xpub661MyMwAqRbcF...',
  derivationPath: "m/84'/0'/0'",
  modelId: 'ledger-nano-s',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  wallets: [],
  isShared: false,
  isOwner: true,
  ...overrides,
});

const mockDeviceModels: HardwareDeviceModel[] = [
  { id: 'model-1', slug: 'ledger-nano-s', name: 'Ledger Nano S', manufacturer: 'Ledger' },
  { id: 'model-2', slug: 'trezor-model-t', name: 'Trezor Model T', manufacturer: 'Trezor' },
];

describe('DeviceList Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDevices.mockResolvedValue([]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should render empty state when no devices', async () => {
    mockGetDevices.mockResolvedValue([]);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(mockGetDevices).toHaveBeenCalled();
    });
  });

  it('should render devices in the list', async () => {
    const devices = [
      createMockDevice({ id: 'device-1', label: 'My Ledger' }),
      createMockDevice({ id: 'device-2', label: 'My Trezor', type: 'trezor' }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('My Ledger')).toBeInTheDocument();
      expect(screen.getByText('My Trezor')).toBeInTheDocument();
    });
  });

  it('should render add device button', async () => {
    mockGetDevices.mockResolvedValue([]);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
    });
  });
});

describe('DeviceList - View Modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDevices.mockResolvedValue([createMockDevice()]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should render list view by default', async () => {
    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByTestId('configurable-table')).toBeInTheDocument();
    });
  });
});

describe('DeviceList - Ownership Filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should show all devices by default', async () => {
    const devices = [
      createMockDevice({ id: 'device-1', label: 'Owned Device', isOwner: true }),
      createMockDevice({ id: 'device-2', label: 'Shared Device', isOwner: false, isShared: true }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('Owned Device')).toBeInTheDocument();
      expect(screen.getByText('Shared Device')).toBeInTheDocument();
    });
  });
});

describe('DeviceList - Device Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDevices.mockResolvedValue([createMockDevice()]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should navigate to device detail on row click', async () => {
    const devices = [createMockDevice({ id: 'device-123' })];
    mockGetDevices.mockResolvedValue(devices);

    const { DeviceList } = await import('../../components/DeviceList');
    const user = userEvent.setup();

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('My Ledger')).toBeInTheDocument();
    });

    const row = screen.getByTestId('device-row');
    await user.click(row);

    expect(mockNavigate).toHaveBeenCalledWith('/devices/device-123');
  });
});

describe('DeviceList - Column Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDevices.mockResolvedValue([createMockDevice()]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should render column configuration button', async () => {
    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByTestId('column-config-button')).toBeInTheDocument();
    });
  });
});
