import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceDetail } from '../../components/DeviceDetail';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'device-1' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: () => <div data-testid="scanner" />,
}));

vi.mock('../../components/DeviceDetail/index', () => ({
  ManualAccountForm: () => <div data-testid="manual-account-form" />,
  AccountList: () => <div data-testid="account-list" />,
  getAccountTypeInfo: () => ({ title: 'Test', description: '', addressPrefix: '' }),
}));

vi.mock('../../components/TransferOwnershipModal', () => ({
  TransferOwnershipModal: () => <div data-testid="transfer-modal" />,
}));

vi.mock('../../components/PendingTransfersPanel', () => ({
  PendingTransfersPanel: () => <div data-testid="pending-transfers" />,
}));

vi.mock('../../services/deviceParsers', () => ({
  parseDeviceJson: vi.fn(),
}));

vi.mock('../../services/hardwareWallet', () => ({
  hardwareWalletService: {},
  isSecureContext: () => false,
  DeviceType: {},
}));

vi.mock('../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
  getWalletIcon: () => <span data-testid="wallet-icon" />,
}));

vi.mock('lucide-react', () => ({
  Edit2: () => <span data-testid="edit-icon" />,
  Save: () => <span data-testid="save-icon" />,
  X: () => <span data-testid="x-icon" />,
  ArrowLeft: () => <span data-testid="arrow-left" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  Users: () => <span data-testid="users-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Send: () => <span data-testid="send-icon" />,
  User: () => <span data-testid="user-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  Usb: () => <span data-testid="usb-icon" />,
  QrCode: () => <span data-testid="qr-icon" />,
  HardDrive: () => <span data-testid="drive-icon" />,
  Camera: () => <span data-testid="camera-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: { id: 'user-1', username: 'alice', isAdmin: false, preferences: {} },
  }),
}));

vi.mock('../../src/api/devices', () => ({
  getDevice: vi.fn(),
  updateDevice: vi.fn(),
  getDeviceModels: vi.fn(),
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
  addDeviceAccount: vi.fn(),
}));

vi.mock('../../src/api/auth', () => ({
  getUserGroups: vi.fn().mockResolvedValue([]),
  searchUsers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/api/admin', () => ({
  getGroups: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import * as devicesApi from '../../src/api/devices';

const mockGetDevice = vi.mocked(devicesApi.getDevice);
const mockGetDeviceModels = vi.mocked(devicesApi.getDeviceModels);
const mockUpdateDevice = vi.mocked(devicesApi.updateDevice);

const deviceData = {
  id: 'device-1',
  type: 'passport',
  label: 'Passport One',
  fingerprint: 'abcd1234',
  isOwner: true,
  userRole: 'owner',
  wallets: [],
};

describe('DeviceDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDevice.mockResolvedValue(deviceData as any);
    mockGetDeviceModels.mockResolvedValue([{ slug: 'passport', manufacturer: 'Foundation', name: 'Passport' }] as any);
  });

  it('renders device details after load', async () => {
    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByText('Passport One')).toBeInTheDocument();
    });

    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByTestId('device-icon')).toBeInTheDocument();
  });

  it('allows entering edit mode and canceling', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByLabelText('Edit label')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Edit label'));
    expect(screen.getByDisplayValue('Passport One')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Cancel editing'));
    expect(screen.getByText('Passport One')).toBeInTheDocument();
  });

  it('saves updated label', async () => {
    const user = userEvent.setup();
    mockUpdateDevice.mockResolvedValue({ label: 'Passport Updated' } as any);

    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByLabelText('Edit label')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Edit label'));
    const input = screen.getByDisplayValue('Passport One');
    await user.clear(input);
    await user.type(input, 'Passport Updated');

    await user.click(screen.getByLabelText('Save label'));

    await waitFor(() => {
      expect(mockUpdateDevice).toHaveBeenCalled();
    });
  });
});
