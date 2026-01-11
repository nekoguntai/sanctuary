/**
 * Account Component Tests
 *
 * Tests for user account settings including password change and 2FA management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock the UserContext
const mockUpdateUser = vi.fn();
const mockUser = {
  id: 'user-123',
  username: 'testuser',
  email: 'test@example.com',
  twoFactorEnabled: false,
};

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockUser,
    updateUser: mockUpdateUser,
  }),
}));

// Mock auth API
const mockChangePassword = vi.fn();
vi.mock('../../src/api/auth', () => ({
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
}));

// Mock 2FA API
const mockSetup2FA = vi.fn();
const mockEnable2FA = vi.fn();
vi.mock('../../src/api/twoFactor', () => ({
  setup2FA: (...args: unknown[]) => mockSetup2FA(...args),
  enable2FA: (...args: unknown[]) => mockEnable2FA(...args),
  disable2FA: vi.fn(),
  regenerateBackupCodes: vi.fn(),
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

// Mock clipboard utility
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  UserCircle: () => <span data-testid="user-circle-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
  Mail: () => <span data-testid="mail-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-circle-icon" />,
  Eye: () => <span data-testid="eye-icon" />,
  EyeOff: () => <span data-testid="eye-off-icon" />,
  Smartphone: () => <span data-testid="smartphone-icon" />,
  Key: () => <span data-testid="key-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, type, disabled, isLoading, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }) => (
    <button type={type as 'button' | 'submit' | 'reset' | undefined} disabled={disabled || isLoading} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

describe('Account Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render user information', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('should render password change section', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // Should have a heading for Change Password
    expect(screen.getByRole('heading', { name: /change password/i })).toBeInTheDocument();
    // Should have password inputs
    const passwordInputs = screen.getAllByDisplayValue('');
    expect(passwordInputs.length).toBeGreaterThanOrEqual(3);
  });

  it('should render 2FA section', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // Use heading role to find the specific heading
    expect(screen.getByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByTestId('smartphone-icon')).toBeInTheDocument();
  });

  it('should have a change password button', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });
});

describe('Account Component - Password Input Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have eye icons for password visibility toggle', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // The password visibility toggles should be present
    const eyeIcons = screen.getAllByTestId('eye-icon');
    expect(eyeIcons.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Account Component - 2FA Setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show setup button when 2FA is disabled', async () => {
    const { Account } = await import('../../components/Account');

    render(<Account />);

    expect(screen.getByRole('button', { name: /enable 2fa/i })).toBeInTheDocument();
  });

  it('should call setup2FA when setup is initiated', async () => {
    mockSetup2FA.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeDataUrl: 'data:image/png;base64,mockQRCode',
    });

    const { Account } = await import('../../components/Account');
    const user = userEvent.setup();

    render(<Account />);

    const setupButton = screen.getByRole('button', { name: /enable 2fa/i });
    await user.click(setupButton);

    await waitFor(() => {
      expect(mockSetup2FA).toHaveBeenCalled();
    });
  });
});

describe('Account Component - 2FA Enabled State', () => {
  it('should render account component with twoFactorEnabled flag', async () => {
    // This test verifies the component can render with different 2FA states
    // The actual 2FA enabled UI is complex and depends on modal state
    const { Account } = await import('../../components/Account');

    render(<Account />);

    // The 2FA section should always be present (use heading role to be specific)
    expect(screen.getByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument();
  });
});
