import React, { useState } from 'react';
import { Button } from './ui/Button';
import { Lock, User, Mail } from 'lucide-react';
import { SanctuaryLogo } from './ui/CustomIcons';
import { useUser } from '../contexts/UserContext';
import { getRegistrationStatus } from '../src/api/auth';

export const Login: React.FC = () => {
  const { login, register, isLoading, error, clearError } = useUser();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  // Check API status and registration status on mount
  React.useEffect(() => {
    const checkApi = async () => {
      try {
        // Use relative URL to go through nginx proxy
        const response = await fetch('/api/v1/health');
        if (response.ok || response.status === 401) {
          // 401 is fine - it means the API is responding but requires auth
          setApiStatus('connected');

          // Check if registration is enabled
          try {
            const regStatus = await getRegistrationStatus();
            setRegistrationEnabled(regStatus.enabled);
          } catch {
            setRegistrationEnabled(false);
          }
        } else {
          setApiStatus('error');
        }
      } catch (err) {
        setApiStatus('error');
      }
    };
    checkApi();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (isRegisterMode) {
      await register(username, password, email || undefined);
    } else {
      await login(username, password);
    }
    // Context will handle success/error states
  };

  const toggleMode = () => {
    setIsRegisterMode(!isRegisterMode);
    clearError();
    setUsername('');
    setPassword('');
    setEmail('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent p-4 transition-colors duration-500">
      <div className="max-w-md w-full space-y-8 animate-fade-in-up">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-sanctuary-200 dark:bg-sanctuary-800 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
            <SanctuaryLogo className="h-10 w-10 text-sanctuary-600 dark:text-sanctuary-300" />
          </div>
          <h2 className="mt-6 text-3xl font-light text-sanctuary-900 dark:text-sanctuary-100 tracking-tight">
            Sanctuary
          </h2>
          <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
            {isRegisterMode ? 'Create your digital sanctuary' : 'Sign in to access your digital sanctuary'}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-xl surface-elevated shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 p-6 space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Username</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-4 w-4 text-sanctuary-400" />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="appearance-none rounded-lg block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                  placeholder="Enter username"
                />
              </div>
            </div>

            {isRegisterMode && (
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Email (Optional)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-sanctuary-400" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="appearance-none rounded-lg block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                    placeholder="your@email.com"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-sanctuary-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none rounded-lg block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                  placeholder="••••••••"
                  minLength={8}
                />
              </div>
              {isRegisterMode && (
                <p className="mt-1 text-xs text-sanctuary-400 dark:text-sanctuary-600">
                  Minimum 8 characters
                </p>
              )}
            </div>
          </div>

          {error && (
            <div className="text-center text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 p-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <Button
              type="submit"
              className="w-full justify-center py-3"
              isLoading={isLoading}
            >
              {isLoading
                ? (isRegisterMode ? 'Creating account...' : 'Signing in...')
                : (isRegisterMode ? 'Create Account' : 'Sign In')
              }
            </Button>

            {(registrationEnabled || isRegisterMode) && (
              <button
                type="button"
                onClick={toggleMode}
                className="w-full text-sm text-sanctuary-500 dark:text-sanctuary-400 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors"
              >
                {isRegisterMode
                  ? 'Already have an account? Sign in'
                  : "Don't have an account? Register"
                }
              </button>
            )}
          </div>
        </form>

        <div className="text-center space-y-2">
          <p className="text-xs text-sanctuary-400 dark:text-sanctuary-600">
            Backend API: {' '}
            {apiStatus === 'checking' && <span className="text-amber-600 dark:text-amber-400">● Connecting...</span>}
            {apiStatus === 'connected' && <span className="text-green-600 dark:text-green-400">● Connected</span>}
            {apiStatus === 'error' && <span className="text-red-600 dark:text-red-400">● Error</span>}
          </p>
          <p className="text-[10px] text-sanctuary-300 dark:text-sanctuary-600">
            {isRegisterMode
              ? 'Create a new account to get started'
              : registrationEnabled
                ? 'Use existing credentials to sign in'
                : 'Contact administrator for account access'}
          </p>
        </div>
      </div>
    </div>
  );
};
