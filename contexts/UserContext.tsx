import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserPreferences } from '../types';
import { themeRegistry } from '../themes';
import * as authApi from '../src/api/auth';
import * as twoFactorApi from '../src/api/twoFactor';
import { ApiError } from '../src/api/client';
import { createLogger } from '../utils/logger';

const log = createLogger('UserContext');

interface TwoFactorPending {
  tempToken: string;
}

interface LoginResult {
  success: boolean;
  requires2FA?: boolean;
  tempToken?: string;
}

interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  twoFactorPending: TwoFactorPending | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  register: (username: string, password: string, email?: string) => Promise<boolean>;
  logout: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  clearError: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorPending, setTwoFactorPending] = useState<TwoFactorPending | null>(null);

  // Check for existing authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (authApi.isAuthenticated()) {
          const currentUser = await authApi.getCurrentUser();
          setUser(currentUser as User);
        }
      } catch (err) {
        log.error('Auth check failed', { error: err });
        authApi.logout(); // Clear invalid token
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Initialize theme based on user preferences whenever user changes
  useEffect(() => {
    if (user && user.preferences) {
      const { darkMode, theme, background, contrastLevel } = user.preferences;

      // Toggle Dark Mode
      if (darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      // Apply theme using the theme registry (with contrast adjustment)
      const mode = darkMode ? 'dark' : 'light';
      themeRegistry.applyTheme(theme, mode, contrastLevel ?? 0);

      // Apply background pattern using the theme registry
      themeRegistry.applyPattern(background, theme);

      // Add smooth transition
      document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';
    } else {
      // Default fallback (Login / Public)
      document.documentElement.classList.add('dark'); // Default to Dark
      themeRegistry.applyTheme('sanctuary', 'dark', 0);
      themeRegistry.applyPattern('sanctuary-hero', 'sanctuary');

      // Add smooth transition
      document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';
    }
  }, [user]);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authApi.login({ username, password });

      // Check if 2FA is required
      if (authApi.requires2FA(response)) {
        setTwoFactorPending({ tempToken: response.tempToken });
        return { success: false, requires2FA: true, tempToken: response.tempToken };
      }

      // Full login success (no 2FA)
      setUser(response.user as User);
      return { success: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed';
      setError(message);
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  };

  const verify2FA = async (code: string): Promise<boolean> => {
    if (!twoFactorPending) {
      setError('No 2FA verification pending');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await twoFactorApi.verify2FA({
        tempToken: twoFactorPending.tempToken,
        code,
      });
      setUser(response.user as User);
      setTwoFactorPending(null);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Invalid verification code';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const cancel2FA = () => {
    setTwoFactorPending(null);
    setError(null);
  };

  const register = async (username: string, password: string, email?: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const { user: authUser } = await authApi.register({ username, password, email });
      setUser(authUser as User);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Registration failed';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authApi.logout();
    setUser(null);
    setError(null);
  };

  const updatePreferences = async (newPrefs: Partial<UserPreferences>) => {
    if (!user || !user.preferences) return;

    const updatedPrefs = { ...user.preferences, ...newPrefs };
    const updatedUser = { ...user, preferences: updatedPrefs };

    setUser(updatedUser); // Optimistic update

    try {
      const apiUser = await authApi.updatePreferences(updatedPrefs);
      setUser(apiUser as User); // Update with server response
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update preferences';
      setError(message);
      // Revert optimistic update on error
      setUser(user);
    }
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        error,
        twoFactorPending,
        login,
        verify2FA,
        cancel2FA,
        register,
        logout,
        updatePreferences,
        clearError,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within UserProvider');
  return context;
};