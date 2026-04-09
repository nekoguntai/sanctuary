/**
 * useLoginFlow - State management hook for the login/register/2FA flow
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useUser } from '../../contexts/UserContext';
import { getRegistrationStatus } from '../../src/api/auth';

export function useLoginFlow() {
  const { login, register, verify2FA, cancel2FA, twoFactorPending, isLoading, error, clearError } = useUser();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const twoFactorInputRef = useRef<HTMLInputElement>(null);
  const [darkMode, setDarkMode] = useState(false);

  // Apply system color scheme preference on login screen
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applySystemTheme = (isDark: boolean) => {
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    // Apply initial preference
    applySystemTheme(mediaQuery.matches);

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => applySystemTheme(e.matches);
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Check API status and registration status on mount
  useEffect(() => {
    const checkApi = async () => {
      try {
        const response = await fetch('/api/v1/health');
        if (response.ok || response.status === 401) {
          setApiStatus('connected');

          try {
            const regStatus = await getRegistrationStatus();
            setRegistrationEnabled(regStatus.enabled);
          } catch {
            setRegistrationEnabled(false);
          }
        } else {
          setApiStatus('error');
        }
      } catch {
        setApiStatus('error');
      }
    };
    checkApi();
  }, []);

  // Focus 2FA input when it appears
  useEffect(() => {
    if (twoFactorPending && twoFactorInputRef.current) {
      twoFactorInputRef.current.focus();
    }
  }, [twoFactorPending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (isRegisterMode) {
      await register(username, password, email || undefined);
    } else {
      await login(username, password);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    await verify2FA(twoFactorCode);
  };

  const handleCancel2FA = () => {
    setTwoFactorCode('');
    cancel2FA();
  };

  const toggleMode = useCallback(() => {
    setIsRegisterMode(prev => !prev);
    clearError();
    setUsername('');
    setPassword('');
    setEmail('');
  }, [clearError]);

  return {
    // State
    isRegisterMode,
    username,
    password,
    email,
    apiStatus,
    registrationEnabled,
    twoFactorCode,
    twoFactorInputRef,
    darkMode,
    twoFactorPending,
    isLoading,
    error,

    // Setters
    setUsername,
    setPassword,
    setEmail,
    setTwoFactorCode,

    // Actions
    handleSubmit,
    handle2FASubmit,
    handleCancel2FA,
    toggleMode,
  };
}
