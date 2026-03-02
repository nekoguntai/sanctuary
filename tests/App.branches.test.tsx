import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

const {
  mockUseUser,
  mockUseNotifications,
  mockGetCurrentUser,
  mockUseWebSocketQueryInvalidation,
} = vi.hoisted(() => ({
  mockUseUser: vi.fn(),
  mockUseNotifications: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockUseWebSocketQueryInvalidation: vi.fn(),
}));

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocketQueryInvalidation: (...args: unknown[]) => mockUseWebSocketQueryInvalidation(...args),
}));

vi.mock('../src/api/auth', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

vi.mock('../contexts/UserContext', () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useUser: (...args: unknown[]) => mockUseUser(...args),
}));

vi.mock('../contexts/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: (...args: unknown[]) => mockUseNotifications(...args),
}));

vi.mock('../contexts/CurrencyContext', () => ({
  CurrencyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../contexts/AppNotificationContext', () => ({
  AppNotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../contexts/SidebarContext', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/Layout', () => ({
  Layout: ({
    children,
    toggleTheme,
    onLogout,
  }: {
    children: React.ReactNode;
    toggleTheme: () => void;
    onLogout: () => void;
  }) => (
    <div>
      <button onClick={toggleTheme}>toggle-theme</button>
      <button onClick={onLogout}>logout</button>
      {children}
    </div>
  ),
}));

vi.mock('../components/Login', () => ({
  Login: () => <div>Login Screen</div>,
}));

vi.mock('../components/Dashboard', () => ({
  Dashboard: () => <div>Dashboard Page</div>,
}));

vi.mock('../components/WalletList', () => ({
  WalletList: () => <div>Wallet List</div>,
}));

vi.mock('../components/WalletDetail', () => ({
  WalletDetail: () => <div>Wallet Detail</div>,
}));

vi.mock('../components/NotificationToast', () => ({
  NotificationContainer: ({ notifications }: { notifications: unknown[] }) => (
    <div data-testid="notification-count">{notifications.length}</div>
  ),
}));

vi.mock('../components/AnimatedBackground', () => ({
  AnimatedBackground: ({
    pattern,
    darkMode,
    opacity,
  }: {
    pattern: string;
    darkMode: boolean;
    opacity: number;
  }) => (
    <div
      data-testid="animated-background"
      data-pattern={pattern}
      data-dark-mode={String(darkMode)}
      data-opacity={String(opacity)}
    />
  ),
}));

vi.mock('../components/ChangePasswordModal', () => ({
  ChangePasswordModal: ({ onPasswordChanged }: { onPasswordChanged: () => Promise<void> }) => (
    <button onClick={() => onPasswordChanged()}>password-changed</button>
  ),
}));

describe('App branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseNotifications.mockReturnValue({
      notifications: [{ id: 'n1' }],
      removeNotification: vi.fn(),
    });
    mockUseWebSocketQueryInvalidation.mockImplementation(() => {});
    mockGetCurrentUser.mockResolvedValue({ id: 'user-1' });
  });

  it('renders login view when unauthenticated', () => {
    mockUseUser.mockReturnValue({
      isAuthenticated: false,
      logout: vi.fn(),
      user: null,
      updatePreferences: vi.fn(),
    });

    render(<App />);

    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
    expect(mockUseWebSocketQueryInvalidation).toHaveBeenCalled();
  });

  it('renders authenticated app with preference fallbacks and theme toggling', () => {
    const updatePreferences = vi.fn();
    const logout = vi.fn();
    mockUseUser.mockReturnValue({
      isAuthenticated: true,
      logout,
      user: {
        usingDefaultPassword: false,
        preferences: {},
      },
      updatePreferences,
    });

    render(<App />);

    expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
    const bg = screen.getByTestId('animated-background');
    expect(bg.getAttribute('data-pattern')).toBe('minimal');
    expect(bg.getAttribute('data-opacity')).toBe('50');
    expect(bg.getAttribute('data-dark-mode')).toBe('false');

    fireEvent.click(screen.getByText('toggle-theme'));
    expect(updatePreferences).toHaveBeenCalledWith({ darkMode: true });

    fireEvent.click(screen.getByText('logout'));
    expect(logout).toHaveBeenCalled();
    expect(screen.queryByText('password-changed')).not.toBeInTheDocument();
  });

  it('shows force-password modal and applies explicit background preferences', async () => {
    mockUseUser.mockReturnValue({
      isAuthenticated: true,
      logout: vi.fn(),
      user: {
        usingDefaultPassword: true,
        preferences: {
          darkMode: true,
          background: 'sakura-petals',
          patternOpacity: 22,
        },
      },
      updatePreferences: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('password-changed')).toBeInTheDocument();
    });

    const bg = screen.getByTestId('animated-background');
    expect(bg.getAttribute('data-pattern')).toBe('sakura-petals');
    expect(bg.getAttribute('data-opacity')).toBe('22');
    expect(bg.getAttribute('data-dark-mode')).toBe('true');
  });

  it('still renders modal for default-password users with missing optional preferences', async () => {
    mockUseUser.mockReturnValue({
      isAuthenticated: true,
      logout: vi.fn(),
      user: {
        usingDefaultPassword: true,
        preferences: {
          darkMode: false,
        },
      },
      updatePreferences: vi.fn(),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('password-changed')).toBeInTheDocument();
    });
  });
});
