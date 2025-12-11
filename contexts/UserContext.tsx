import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserPreferences } from '../types';
import { themeRegistry } from '../themes';
import * as authApi from '../src/api/auth';
import { ApiError } from '../src/api/client';

interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
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

  // Check for existing authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (authApi.isAuthenticated()) {
          const currentUser = await authApi.getCurrentUser();
          setUser(currentUser as User);
        }
      } catch (err) {
        console.error('Auth check failed:', err);
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
      const { darkMode, theme, background } = user.preferences;

      // Toggle Dark Mode
      if (darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      // Apply theme using the theme registry
      const mode = darkMode ? 'dark' : 'light';
      themeRegistry.applyTheme(theme, mode);

      // Apply background pattern using the theme registry
      themeRegistry.applyPattern(background, theme);

      // Add smooth transition
      document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';
    } else {
      // Default fallback (Login / Public)
      document.documentElement.classList.add('dark'); // Default to Dark
      themeRegistry.applyTheme('sanctuary', 'dark');
      themeRegistry.applyPattern('sanctuary-hero', 'sanctuary');

      // Add smooth transition
      document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';
    }
  }, [user]);

  const login = async (username: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const { user: authUser } = await authApi.login({ username, password });
      setUser(authUser as User);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
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
        login,
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