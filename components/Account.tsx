import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';
import { UserCircle, Lock, Mail, Shield, Check, AlertCircle, Eye, EyeOff, Smartphone, Key, RefreshCw, Copy, X } from 'lucide-react';
import { Button } from './ui/Button';
import * as authApi from '../src/api/auth';
import * as twoFactorApi from '../src/api/twoFactor';
import { ApiError } from '../src/api/client';
import { createLogger } from '../utils/logger';
import { copyToClipboard as clipboardCopy } from '../utils/clipboard';

const log = createLogger('Account');

export const Account: React.FC = () => {
  const { user } = useUser();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(user?.twoFactorEnabled || false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showBackupCodesModal, setShowBackupCodesModal] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [setupVerifyCode, setSetupVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [regenerateToken, setRegenerateToken] = useState('');
  const [is2FALoading, setIs2FALoading] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    // Validation
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setIsChangingPassword(true);

    try {
      await authApi.changePassword({
        currentPassword,
        newPassword,
      });

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      log.error('Password change error', { error: err });
      const message = err instanceof ApiError ? err.message : 'Failed to change password';
      setPasswordError(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  // 2FA Handlers
  const handleStartSetup = async () => {
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      const data = await twoFactorApi.setup2FA();
      setSetupData(data);
      setShowSetupModal(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to start 2FA setup';
      setTwoFactorError(message);
    } finally {
      setIs2FALoading(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    if (setupVerifyCode.length < 6) return;
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      const result = await twoFactorApi.enable2FA(setupVerifyCode);
      setBackupCodes(result.backupCodes);
      setTwoFactorEnabled(true);
      setSetupVerifyCode('');
      setSetupData(null);
      // Keep modal open to show backup codes
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Invalid verification code';
      setTwoFactorError(message);
    } finally {
      setIs2FALoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!disablePassword || !disableToken) return;
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      await twoFactorApi.disable2FA({ password: disablePassword, token: disableToken });
      setTwoFactorEnabled(false);
      setShowDisableModal(false);
      setDisablePassword('');
      setDisableToken('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to disable 2FA';
      setTwoFactorError(message);
    } finally {
      setIs2FALoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!disablePassword || !regenerateToken) return;
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      const result = await twoFactorApi.regenerateBackupCodes({ password: disablePassword, token: regenerateToken });
      setBackupCodes(result.backupCodes);
      setDisablePassword('');
      setRegenerateToken('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to regenerate backup codes';
      setTwoFactorError(message);
    } finally {
      setIs2FALoading(false);
    }
  };

  const copyToClipboard = async (text: string, codeId: string) => {
    const success = await clipboardCopy(text);
    if (success) {
      setCopiedCode(codeId);
      setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  const copyAllBackupCodes = async () => {
    const success = await clipboardCopy(backupCodes.join('\n'));
    if (success) {
      setCopiedCode('all');
      setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  const closeSetupModal = () => {
    setShowSetupModal(false);
    setSetupData(null);
    setSetupVerifyCode('');
    setBackupCodes([]);
    setTwoFactorError(null);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Account Settings</h2>
        <p className="text-sanctuary-500">Manage your account information and security</p>
      </div>

      {/* Account Information */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <UserCircle className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Profile Information</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username</label>
            <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sanctuary-900 dark:text-sanctuary-100 font-mono">
              {user?.username}
            </div>
          </div>

          {user?.email && (
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email</label>
              <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sanctuary-900 dark:text-sanctuary-100 font-mono flex items-center">
                <Mail className="w-4 h-4 mr-2 text-sanctuary-400" />
                {user.email}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Account Type</label>
            <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
              <Shield className={`w-4 h-4 mr-2 ${user?.isAdmin ? 'text-primary-600' : 'text-sanctuary-400'}`} />
              {user?.isAdmin ? 'Administrator' : 'Standard User'}
            </div>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <Lock className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Change Password</h3>
          </div>
        </div>

        <form onSubmit={handlePasswordChange} className="p-6 space-y-6">
          {passwordError && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start animate-fade-in">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800 dark:text-red-300">{passwordError}</span>
            </div>
          )}

          {passwordSuccess && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl flex items-start animate-fade-in">
              <Check className="w-5 h-5 text-green-600 dark:text-green-400 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-green-800 dark:text-green-300">Password changed successfully</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Current Password</label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-sanctuary-500 mt-1">Minimum 6 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Confirm New Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 flex justify-end">
            <Button type="submit" isLoading={isChangingPassword} disabled={passwordSuccess}>
              {passwordSuccess ? 'Password Changed' : 'Change Password'}
            </Button>
          </div>
        </form>
      </div>

      {/* Two-Factor Authentication */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <Smartphone className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Two-Factor Authentication</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
            Two-factor authentication adds an extra layer of security to your account by requiring a verification code in addition to your password.
          </p>

          {twoFactorError && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start animate-fade-in">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800 dark:text-red-300">{twoFactorError}</span>
            </div>
          )}

          <div className="flex items-center justify-between p-4 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${twoFactorEnabled ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'}`}>
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  {twoFactorEnabled ? '2FA Enabled' : '2FA Disabled'}
                </p>
                <p className="text-sm text-sanctuary-500">
                  {twoFactorEnabled ? 'Your account is protected with 2FA' : 'Enable 2FA for enhanced security'}
                </p>
              </div>
            </div>
            <Button
              variant={twoFactorEnabled ? 'secondary' : 'primary'}
              onClick={twoFactorEnabled ? () => setShowDisableModal(true) : handleStartSetup}
              isLoading={is2FALoading && !showSetupModal && !showDisableModal}
            >
              {twoFactorEnabled ? 'Disable' : 'Enable 2FA'}
            </Button>
          </div>

          {twoFactorEnabled && (
            <div className="flex items-center justify-between p-4 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">Backup Codes</p>
                  <p className="text-sm text-sanctuary-500">Generate new backup codes for account recovery</p>
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={() => setShowBackupCodesModal(true)}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerate
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 2FA Setup Modal */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex items-center justify-between">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {backupCodes.length > 0 ? 'Save Backup Codes' : 'Set Up Two-Factor Authentication'}
              </h3>
              <button
                onClick={closeSetupModal}
                className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {backupCodes.length > 0 ? (
                /* Show backup codes after successful setup */
                <>
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      <strong>Important:</strong> Save these backup codes in a secure place. You won't be able to see them again!
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, index) => (
                      <button
                        key={code}
                        onClick={() => copyToClipboard(code, `code-${index}`)}
                        className="flex items-center justify-between p-2 font-mono text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded hover:border-primary-500 transition-colors"
                      >
                        <span>{code}</span>
                        {copiedCode === `code-${index}` ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4 text-sanctuary-400" />
                        )}
                      </button>
                    ))}
                  </div>
                  <Button onClick={copyAllBackupCodes} variant="secondary" className="w-full">
                    {copiedCode === 'all' ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy All Codes
                      </>
                    )}
                  </Button>
                  <Button onClick={closeSetupModal} className="w-full">
                    I've Saved My Codes
                  </Button>
                </>
              ) : (
                /* QR Code setup flow */
                <>
                  {setupData && (
                    <>
                      <div className="text-center">
                        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-4">
                          Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                        </p>
                        <div className="inline-block p-4 bg-white rounded-xl">
                          <img src={setupData.qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48" />
                        </div>
                      </div>

                      <div className="text-center">
                        <p className="text-xs text-sanctuary-500 mb-1">Or enter this code manually:</p>
                        <button
                          onClick={() => copyToClipboard(setupData.secret, 'secret')}
                          className="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded hover:border-primary-500 transition-colors"
                        >
                          {setupData.secret}
                          {copiedCode === 'secret' ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4 text-sanctuary-400" />
                          )}
                        </button>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                          Enter verification code
                        </label>
                        <input
                          type="text"
                          value={setupVerifyCode}
                          onChange={(e) => setSetupVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-center text-2xl tracking-[0.5em] font-mono text-sanctuary-900 dark:text-sanctuary-100"
                          maxLength={6}
                        />
                      </div>

                      {twoFactorError && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                          {twoFactorError}
                        </div>
                      )}

                      <Button
                        onClick={handleVerifyAndEnable}
                        disabled={setupVerifyCode.length < 6}
                        isLoading={is2FALoading}
                        className="w-full"
                      >
                        Verify and Enable 2FA
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Disable 2FA Modal */}
      {showDisableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full">
            <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex items-center justify-between">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Disable Two-Factor Authentication</h3>
              <button
                onClick={() => { setShowDisableModal(false); setTwoFactorError(null); setDisablePassword(''); setDisableToken(''); }}
                className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Disabling 2FA will make your account less secure. You'll only need your password to log in.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password</label>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                  placeholder="Enter your password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">2FA Code</label>
                <input
                  type="text"
                  value={disableToken}
                  onChange={(e) => setDisableToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                  className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-center tracking-widest font-mono text-sanctuary-900 dark:text-sanctuary-100"
                  placeholder="000000"
                  maxLength={8}
                />
              </div>

              {twoFactorError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                  {twoFactorError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => { setShowDisableModal(false); setTwoFactorError(null); setDisablePassword(''); setDisableToken(''); }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleDisable2FA}
                  disabled={!disablePassword || disableToken.length < 6}
                  isLoading={is2FALoading}
                  className="flex-1 bg-red-600 hover:bg-red-700"
                >
                  Disable 2FA
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Backup Codes Modal */}
      {showBackupCodesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex items-center justify-between">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {backupCodes.length > 0 ? 'New Backup Codes' : 'Regenerate Backup Codes'}
              </h3>
              <button
                onClick={() => { setShowBackupCodesModal(false); setBackupCodes([]); setTwoFactorError(null); setDisablePassword(''); setRegenerateToken(''); }}
                className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {backupCodes.length > 0 ? (
                <>
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      <strong>Important:</strong> Save these new backup codes. Your old codes are now invalid!
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, index) => (
                      <button
                        key={code}
                        onClick={() => copyToClipboard(code, `regen-${index}`)}
                        className="flex items-center justify-between p-2 font-mono text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded hover:border-primary-500 transition-colors"
                      >
                        <span>{code}</span>
                        {copiedCode === `regen-${index}` ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4 text-sanctuary-400" />
                        )}
                      </button>
                    ))}
                  </div>
                  <Button onClick={copyAllBackupCodes} variant="secondary" className="w-full">
                    {copiedCode === 'all' ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy All Codes
                      </>
                    )}
                  </Button>
                  <Button onClick={() => { setShowBackupCodesModal(false); setBackupCodes([]); }} className="w-full">
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
                    This will generate new backup codes and invalidate your existing ones. Enter your password and a 2FA code to confirm.
                  </p>

                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password</label>
                    <input
                      type="password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                      placeholder="Enter your password"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">2FA Code</label>
                    <input
                      type="text"
                      value={regenerateToken}
                      onChange={(e) => setRegenerateToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-center tracking-widest font-mono text-sanctuary-900 dark:text-sanctuary-100"
                      placeholder="000000"
                      maxLength={6}
                    />
                  </div>

                  {twoFactorError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                      {twoFactorError}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="secondary"
                      onClick={() => { setShowBackupCodesModal(false); setTwoFactorError(null); setDisablePassword(''); setRegenerateToken(''); }}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleRegenerateBackupCodes}
                      disabled={!disablePassword || regenerateToken.length < 6}
                      isLoading={is2FALoading}
                      className="flex-1"
                    >
                      Generate New Codes
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
