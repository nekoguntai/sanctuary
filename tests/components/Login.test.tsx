/**
 * Login Component Tests
 *
 * Tests user authentication, registration, and 2FA flows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock the UserContext
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockVerify2FA = vi.fn();
const mockCancel2FA = vi.fn();
const mockClearError = vi.fn();

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    login: mockLogin,
    register: mockRegister,
    verify2FA: mockVerify2FA,
    cancel2FA: mockCancel2FA,
    twoFactorPending: null,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  }),
}));

// Mock auth API
vi.mock('../../src/api/auth', () => ({
  getRegistrationStatus: vi.fn().mockResolvedValue({ enabled: true }),
}));

// Mock lucide-react icons to avoid rendering issues
vi.mock('lucide-react', () => ({
  Lock: () => <span data-testid="lock-icon" />,
  User: () => <span data-testid="user-icon" />,
  Mail: () => <span data-testid="mail-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  ArrowLeft: () => <span data-testid="arrow-left-icon" />,
}));

// Mock custom icons
vi.mock('../../components/ui/CustomIcons', () => ({
  SanctuaryLogo: () => <span data-testid="sanctuary-logo" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, type, isLoading, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }) => (
    <button type={type as 'button' | 'submit' | 'reset' | undefined} disabled={disabled || isLoading} {...props}>
      {isLoading ? 'Loading...' : children}
    </button>
  ),
}));

// Mock global fetch for API health check
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Login Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });

    // Mock matchMedia for system theme detection
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('should render login form by default', async () => {
    const { Login } = await import('../../components/Login');

    render(<Login />);

    expect(screen.getByText('Sanctuary')).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should display registration toggle when enabled', async () => {
    const { Login } = await import('../../components/Login');

    render(<Login />);

    await waitFor(() => {
      expect(screen.getByText(/don't have an account\? register/i)).toBeInTheDocument();
    });
  });

  it('should toggle to register mode when clicked', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    render(<Login />);

    const toggleButton = await screen.findByText(/don't have an account\? register/i);
    await user.click(toggleButton);

    expect(screen.getByText(/create your digital sanctuary/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('should call login on form submit in login mode', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    render(<Login />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'testpassword');
    await user.click(submitButton);

    expect(mockClearError).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledWith('testuser', 'testpassword');
  });

  it('should call register on form submit in register mode', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    render(<Login />);

    // Toggle to register mode
    const toggleButton = await screen.findByText(/don't have an account\? register/i);
    await user.click(toggleButton);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const emailInput = screen.getByLabelText(/email/i);
    const submitButton = screen.getByRole('button', { name: /create account/i });

    await user.type(usernameInput, 'newuser');
    await user.type(passwordInput, 'newpassword123');
    await user.type(emailInput, 'test@example.com');
    await user.click(submitButton);

    expect(mockClearError).toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith('newuser', 'newpassword123', 'test@example.com');
  });

  it('should check API health status on mount', async () => {
    const { Login } = await import('../../components/Login');

    render(<Login />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/health');
    });
  });

  it('should display API connected status', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { Login } = await import('../../components/Login');

    render(<Login />);

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
  });

  it('should display API error status on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { Login } = await import('../../components/Login');

    render(<Login />);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it('should clear form fields when toggling modes', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    render(<Login />);

    const usernameInput = screen.getByLabelText(/username/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'testpassword');

    // Toggle to register mode
    const toggleButton = await screen.findByText(/don't have an account\? register/i);
    await user.click(toggleButton);

    // Fields should be cleared
    expect(usernameInput.value).toBe('');
    expect(passwordInput.value).toBe('');
  });
});

describe('Login Component - 2FA Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('should display 2FA verification screen when pending', async () => {
    // Override the mock for this test
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: { tempToken: 'test-token' },
        isLoading: false,
        error: null,
        clearError: mockClearError,
      }),
    }));

    // Need to reimport to get the mocked version
    vi.resetModules();
    const { Login } = await import('../../components/Login');

    render(<Login />);

    expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
  });

  it('should call verify2FA on 2FA form submit', async () => {
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: { tempToken: 'test-token' },
        isLoading: false,
        error: null,
        clearError: mockClearError,
      }),
    }));

    vi.resetModules();
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    render(<Login />);

    const codeInput = screen.getByLabelText(/verification code/i);
    await user.type(codeInput, '123456');

    const verifyButton = screen.getByRole('button', { name: /verify/i });
    await user.click(verifyButton);

    expect(mockClearError).toHaveBeenCalled();
    expect(mockVerify2FA).toHaveBeenCalledWith('123456');
  });

  it('should call cancel2FA when back button clicked', async () => {
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: { tempToken: 'test-token' },
        isLoading: false,
        error: null,
        clearError: mockClearError,
      }),
    }));

    vi.resetModules();
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    render(<Login />);

    const backButton = screen.getByText(/back to login/i);
    await user.click(backButton);

    expect(mockCancel2FA).toHaveBeenCalled();
  });
});

describe('Login Component - Error Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('should display error message when error exists', async () => {
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: null,
        isLoading: false,
        error: 'Invalid credentials',
        clearError: mockClearError,
      }),
    }));

    vi.resetModules();
    const { Login } = await import('../../components/Login');

    render(<Login />);

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
  });
});
