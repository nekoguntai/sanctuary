/**
 * BackupRestore Component Tests
 *
 * Tests the backup and restore functionality for database management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

// Mock admin API
const mockCreateBackup = vi.fn();
const mockValidateBackup = vi.fn();
const mockRestoreBackup = vi.fn();
const mockGetEncryptionKeys = vi.fn();

vi.mock('../../src/api/admin', () => ({
  createBackup: (...args: unknown[]) => mockCreateBackup(...args),
  validateBackup: (...args: unknown[]) => mockValidateBackup(...args),
  restoreBackup: (...args: unknown[]) => mockRestoreBackup(...args),
  getEncryptionKeys: () => mockGetEncryptionKeys(),
}));

// Mock notification context
const mockAddNotification = vi.fn();
vi.mock('../../contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({
    addNotification: mockAddNotification,
  }),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Database: () => <span data-testid="database-icon" />,
  Download: () => <span data-testid="download-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-circle-icon" />,
  FileJson: () => <span data-testid="file-json-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  User: () => <span data-testid="user-icon" />,
  Layers: () => <span data-testid="layers-icon" />,
  X: () => <span data-testid="x-icon" />,
  Key: () => <span data-testid="key-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  Eye: () => <span data-testid="eye-icon" />,
  EyeOff: () => <span data-testid="eye-off-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  FileText: () => <span data-testid="file-text-icon" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe('BackupRestore Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset localStorage
    localStorage.clear();
    // Setup default mock responses
    mockGetEncryptionKeys.mockResolvedValue({
      encryptionKey: 'test-encryption-key-12345',
      encryptionSalt: 'test-salt-abcdef',
    });
  });

  it('should render backup tab by default', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    render(<BackupRestore />, { wrapper: createWrapper() });

    expect(screen.getByText(/backup & restore/i)).toBeInTheDocument();
    expect(screen.getByText(/create backup/i)).toBeInTheDocument();
    expect(screen.getByText(/download backup/i)).toBeInTheDocument();
  });

  it('should switch to restore tab when clicked', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    render(<BackupRestore />, { wrapper: createWrapper() });

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    // Should show restore content - look for the heading specifically
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /restore from backup/i })).toBeInTheDocument();
    });
  });

  it('should show encryption keys section', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    render(<BackupRestore />, { wrapper: createWrapper() });

    // Encryption keys section is always visible
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /encryption keys/i })).toBeInTheDocument();
    });
  });

  it('should load encryption keys on mount', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    render(<BackupRestore />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockGetEncryptionKeys).toHaveBeenCalled();
    });
  });

  it('should toggle include cache checkbox', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    render(<BackupRestore />, { wrapper: createWrapper() });

    // Wait for keys to load
    await waitFor(() => {
      expect(mockGetEncryptionKeys).toHaveBeenCalled();
    });

    // Find the toggle button (it's the button element within the toggle container)
    const toggleLabel = screen.getByText(/include cache data/i);
    const toggleContainer = toggleLabel.closest('div')?.parentElement;
    const toggleButton = toggleContainer?.querySelector('button');
    expect(toggleButton).toBeInTheDocument();

    // Initially should not be enabled
    expect(toggleButton).not.toHaveClass('bg-primary-600');

    await user.click(toggleButton!);

    // The toggle should have changed state (has specific class when enabled)
    await waitFor(() => {
      expect(toggleButton).toHaveClass('bg-primary-600');
    });
  });

  it('should allow entering backup description', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    render(<BackupRestore />, { wrapper: createWrapper() });

    const descriptionInput = screen.getByPlaceholderText(/before migration/i);
    await user.type(descriptionInput, 'Test backup');

    expect(descriptionInput).toHaveValue('Test backup');
  });

  it('should create backup when download button is clicked', async () => {
    const mockBlob = new Blob(['{}'], { type: 'application/json' });
    mockCreateBackup.mockResolvedValue(mockBlob);

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    // Mock URL.createObjectURL and revokeObjectURL
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test');
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    render(<BackupRestore />, { wrapper: createWrapper() });

    const downloadButton = screen.getByText(/download backup/i);
    await user.click(downloadButton);

    await waitFor(() => {
      expect(mockCreateBackup).toHaveBeenCalledWith({
        includeCache: false,
        description: undefined,
      });
    });
  });

  it('should show warning in restore tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    render(<BackupRestore />, { wrapper: createWrapper() });

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    await waitFor(() => {
      expect(screen.getByText(/delete all existing data/i)).toBeInTheDocument();
    });
  });

  it('should show file upload area in restore tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    render(<BackupRestore />, { wrapper: createWrapper() });

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    await waitFor(() => {
      expect(screen.getByText(/drop backup file here/i)).toBeInTheDocument();
    });
  });

  it('should show about backups info when on backup tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    render(<BackupRestore />, { wrapper: createWrapper() });

    expect(screen.getByText(/about backups/i)).toBeInTheDocument();
    expect(screen.getByText(/backups include all users/i)).toBeInTheDocument();
  });

  it('should show about restore info when on restore tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    render(<BackupRestore />, { wrapper: createWrapper() });

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    await waitFor(() => {
      expect(screen.getByText(/about restore/i)).toBeInTheDocument();
      expect(screen.getByText(/restoring will completely replace/i)).toBeInTheDocument();
    });
  });
});

describe('BackupRestore Component - Encryption Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetEncryptionKeys.mockResolvedValue({
      encryptionKey: 'test-encryption-key-12345',
      encryptionSalt: 'test-salt-abcdef',
    });
  });

  it('should display masked encryption keys by default', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    render(<BackupRestore />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/encryption_key/i)).toBeInTheDocument();
      expect(screen.getByText(/encryption_salt/i)).toBeInTheDocument();
    });

    // Keys should be masked with bullets
    expect(screen.getAllByText(/•+/).length).toBeGreaterThan(0);
  });

  it('should handle encryption key loading error gracefully', async () => {
    mockGetEncryptionKeys.mockRejectedValue(new Error('Failed to load'));

    const { BackupRestore } = await import('../../components/BackupRestore');

    render(<BackupRestore />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/failed to load encryption keys/i)).toBeInTheDocument();
    });
  });
});
