import React, { useState } from 'react';
import { useCurrency, FiatCurrency } from '../contexts/CurrencyContext';
import { useUser } from '../contexts/UserContext';
import { Monitor, DollarSign, Globe, Palette, Image as ImageIcon, Check, Waves, Minus, Server, Send, Eye, EyeOff, RefreshCw, AlertCircle, ExternalLink, Volume2, Contrast, Layers, Sparkles, Shield, Bitcoin, Circle, Binary, Network, Flower2, Snowflake, Box, Calendar, Sun, Leaf, CloudSnow } from 'lucide-react';
import { useNotificationSound } from '../hooks/useNotificationSound';
import { Button } from './ui/Button';
import { SanctuaryLogo } from './ui/CustomIcons';
import { ThemeOption, BackgroundOption } from '../types';
import { themeRegistry } from '../themes';
import * as authApi from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { createLogger } from '../utils/logger';
import { logError } from '../utils/errorHandler';

const log = createLogger('Settings');

// Telegram Settings Component
const TelegramSettings: React.FC = () => {
  const { user, updatePreferences } = useUser();

  const [botToken, setBotToken] = useState(user?.preferences?.telegram?.botToken || '');
  const [chatId, setChatId] = useState(user?.preferences?.telegram?.chatId || '');
  const [enabled, setEnabled] = useState(user?.preferences?.telegram?.enabled || false);
  const [showBotToken, setShowBotToken] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingChatId, setIsFetchingChatId] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTestConnection = async () => {
    if (!botToken || !chatId) {
      setError('Please enter both bot token and chat ID');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await authApi.testTelegramConfig(botToken, chatId);
      if (result.success) {
        setTestResult({ success: true, message: 'Test message sent successfully!' });
      } else {
        setTestResult({ success: false, message: result.error || 'Failed to send test message' });
      }
    } catch (err) {
      const message = logError(log, err, 'Failed to test Telegram connection', {
        fallbackMessage: 'Failed to test connection',
      });
      setTestResult({ success: false, message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFetchChatId = async () => {
    if (!botToken) {
      setError('Please enter your bot token first');
      return;
    }

    setIsFetchingChatId(true);
    setError(null);
    setTestResult(null);

    try {
      const result = await authApi.fetchTelegramChatId(botToken);
      if (result.success && result.chatId) {
        setChatId(result.chatId);
        const username = result.username ? ` (@${result.username})` : '';
        setTestResult({ success: true, message: `Chat ID found${username}!` });
      } else {
        setTestResult({ success: false, message: result.error || 'Failed to fetch chat ID' });
      }
    } catch (err) {
      const message = logError(log, err, 'Failed to fetch Telegram chat ID', {
        fallbackMessage: 'Failed to fetch chat ID',
      });
      setTestResult({ success: false, message });
    } finally {
      setIsFetchingChatId(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      await updatePreferences({
        telegram: {
          botToken,
          chatId,
          enabled,
          wallets: user?.preferences?.telegram?.wallets || {},
        },
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      const message = logError(log, err, 'Failed to save Telegram settings', {
        fallbackMessage: 'Failed to save settings',
      });
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);

    // Save immediately when toggling
    try {
      await updatePreferences({
        telegram: {
          botToken,
          chatId,
          enabled: newEnabled,
          wallets: user?.preferences?.telegram?.wallets || {},
        },
      });
    } catch (err) {
      // Revert on error
      setEnabled(!newEnabled);
      const message = logError(log, err, 'Failed to toggle Telegram notifications', {
        fallbackMessage: 'Failed to update settings',
      });
      setError(message);
    }
  };

  const isConfigured = botToken && chatId;

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Send className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Telegram Notifications</h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          Receive transaction notifications via Telegram. Create your own bot using{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center"
          >
            @BotFather
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>
          {' '}and get your chat ID from{' '}
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center"
          >
            @userinfobot
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>.
        </p>

        {/* Bot Token */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
            Bot Token
          </label>
          <div className="relative">
            <input
              type={showBotToken ? 'text' : 'password'}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              className="w-full px-4 py-2.5 pr-12 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sanctuary-900 dark:text-sanctuary-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowBotToken(!showBotToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-sanctuary-500">From @BotFather when you create your bot</p>
        </div>

        {/* Chat ID */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
            Chat ID
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="123456789"
              className="flex-1 px-4 py-2.5 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sanctuary-900 dark:text-sanctuary-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all font-mono text-sm"
            />
            <Button
              variant="secondary"
              onClick={handleFetchChatId}
              disabled={!botToken || isFetchingChatId}
              title="Fetch chat ID from bot (send /start to your bot first)"
            >
              {isFetchingChatId ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                'Fetch'
              )}
            </Button>
          </div>
          <p className="text-xs text-sanctuary-500">
            Send <code className="px-1 py-0.5 bg-sanctuary-100 dark:bg-sanctuary-800 rounded">/start</code> to your bot, then click Fetch
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-500" />
            <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div className={`p-3 rounded-xl flex items-center space-x-2 ${
            testResult.success
              ? 'bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800'
              : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800'
          }`}>
            {testResult.success ? (
              <Check className="w-4 h-4 text-success-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            )}
            <span className={`text-sm ${
              testResult.success
                ? 'text-success-600 dark:text-success-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}>{testResult.message}</span>
          </div>
        )}

        {/* Save Success */}
        {saveSuccess && (
          <div className="p-3 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 rounded-xl flex items-center space-x-2">
            <Check className="w-4 h-4 text-success-500" />
            <span className="text-sm text-success-600 dark:text-success-400">Settings saved successfully</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <Button
              variant="secondary"
              onClick={handleTestConnection}
              disabled={!botToken || !chatId || isTesting}
            >
              {isTesting ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Test
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Save
            </Button>
          </div>

          {/* Enable toggle */}
          <label className="flex items-center space-x-3 cursor-pointer">
            <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              type="button"
              onClick={handleToggleEnabled}
              disabled={!isConfigured}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                enabled && isConfigured
                  ? 'bg-success-500'
                  : 'bg-sanctuary-300 dark:bg-sanctuary-700'
              } ${!isConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>
        </div>

        {isConfigured && (
          <p className="text-xs text-sanctuary-500 dark:text-sanctuary-500">
            Configure per-wallet notification preferences in each wallet's Settings tab.
          </p>
        )}
      </div>
    </div>
  );
};

// Notification Sound Settings Component
const NotificationSoundSettings: React.FC = () => {
  const { user, updatePreferences } = useUser();
  const { playSound, soundPresets, soundEvents, getEventConfig } = useNotificationSound();

  const soundPrefs = user?.preferences?.notificationSounds || {
    enabled: true,
    volume: 50,
  };

  const handleToggleSounds = async () => {
    const newEnabled = !soundPrefs.enabled;
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        enabled: newEnabled,
      },
    });
  };

  const handleEventToggle = async (eventId: 'confirmation' | 'receive' | 'send') => {
    const currentConfig = getEventConfig(eventId);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        [eventId]: {
          ...currentConfig,
          enabled: !currentConfig.enabled,
        },
      },
    });
  };

  const handleEventSoundChange = async (eventId: 'confirmation' | 'receive' | 'send', sound: string) => {
    const currentConfig = getEventConfig(eventId);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        [eventId]: {
          ...currentConfig,
          sound,
        },
      },
    });
    // Play preview of selected sound
    if (sound !== 'none') {
      playSound(sound as any, soundPrefs.volume);
    }
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseInt(e.target.value, 10);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        volume,
      },
    });
  };

  const handleTestSound = (sound: string) => {
    if (sound !== 'none') {
      playSound(sound as any, soundPrefs.volume);
    }
  };

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Volume2 className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Notification Sounds</h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          Play audio notifications for wallet events. Configure different sounds for each event type.
        </p>

        {/* Master Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable Sounds</label>
            <p className="text-sm text-sanctuary-500">Master toggle for all notification sounds</p>
          </div>
          <button
            onClick={handleToggleSounds}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              soundPrefs.enabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              soundPrefs.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {/* Per-Event Sound Configuration */}
        <div className={`pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 space-y-4 ${!soundPrefs.enabled ? 'opacity-50' : ''}`}>
          <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Event Sounds</label>

          {soundEvents.map((event) => {
            const config = getEventConfig(event.id);
            return (
              <div key={event.id} className="flex items-center gap-3 p-3 surface-muted rounded-xl">
                {/* Event toggle */}
                <button
                  onClick={() => handleEventToggle(event.id)}
                  disabled={!soundPrefs.enabled}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    config.enabled && soundPrefs.enabled ? 'bg-success-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                  } ${!soundPrefs.enabled ? 'cursor-not-allowed' : ''}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    config.enabled && soundPrefs.enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>

                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{event.name}</div>
                  <div className="text-xs text-sanctuary-500 truncate">{event.description}</div>
                </div>

                {/* Sound selector */}
                <select
                  value={config.sound}
                  onChange={(e) => handleEventSoundChange(event.id, e.target.value)}
                  disabled={!soundPrefs.enabled || !config.enabled}
                  className="px-2 py-1 text-xs surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {soundPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>

                {/* Test button */}
                <button
                  onClick={() => handleTestSound(config.sound)}
                  disabled={!soundPrefs.enabled || !config.enabled || config.sound === 'none'}
                  className="p-1.5 text-sanctuary-500 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Test sound"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Volume Slider */}
        <div className={`pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 ${!soundPrefs.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Volume</label>
            <span className="text-sm text-sanctuary-500">{soundPrefs.volume ?? 50}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={soundPrefs.volume ?? 50}
            onChange={handleVolumeChange}
            disabled={!soundPrefs.enabled}
            className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
          />
        </div>
      </div>
    </div>
  );
};

// Tab type definition
type SettingsTab = 'appearance' | 'display' | 'services' | 'notifications';

// Tab configuration
const SETTINGS_TABS: { id: SettingsTab; name: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'appearance', name: 'Appearance', icon: Palette },
  { id: 'display', name: 'Display', icon: Monitor },
  { id: 'services', name: 'Services', icon: Globe },
  { id: 'notifications', name: 'Notifications', icon: Volume2 },
];

// Appearance Tab Content
const AppearanceTab: React.FC = () => {
  const { user, updatePreferences } = useUser();

  const currentTheme = user?.preferences?.theme || 'sanctuary';
  const currentBg = user?.preferences?.background || 'zen';
  const isDark = user?.preferences?.darkMode || false;

  const themes = themeRegistry.getAllMetadata().map(theme => ({
    id: theme.id as ThemeOption,
    name: theme.name,
    color: theme.preview?.primaryColor || '#7d7870'
  }));

  const bgIconMap: Record<string, any> = {
    minimal: Minus,
    zen: ImageIcon,
    sanctuary: SanctuaryLogo,
    'sanctuary-hero': SanctuaryLogo,
    waves: Waves,
    lines: Minus,
    circuit: Server,
    topography: Globe,
    'sakura-petals': Flower2,
    'floating-shields': Shield,
    'bitcoin-particles': Bitcoin,
    'stacking-blocks': Box,
    'digital-rain': Binary,
    'constellation': Network,
    'sanctuary-logo': SanctuaryLogo,
    'snowfall': Snowflake,
  };

  // Season icons for the time-based section
  const seasonIcons: Record<string, any> = {
    spring: Flower2,
    summer: Sun,
    fall: Leaf,
    winter: CloudSnow,
  };

  const currentSeason = themeRegistry.getCurrentSeason();
  const seasonalBackground = themeRegistry.getSeasonalBackground();

  const allPatterns = themeRegistry.getAllPatterns(currentTheme);

  const staticBackgrounds = allPatterns
    .filter(pattern => !pattern.animated)
    .map(pattern => ({
      id: pattern.id as BackgroundOption,
      name: pattern.name,
      icon: bgIconMap[pattern.id] || ImageIcon
    }));

  const animatedBackgrounds = allPatterns
    .filter(pattern => pattern.animated)
    .map(pattern => ({
      id: pattern.id as BackgroundOption,
      name: pattern.name,
      icon: bgIconMap[pattern.id] || Sparkles
    }));

  return (
    <div className="space-y-6">
      {/* Color Theme */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Color Theme</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Choose a color scheme for your wallet</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {themes.map(theme => (
              <button
                key={theme.id}
                onClick={() => updatePreferences({ theme: theme.id })}
                className={`relative p-3 rounded-xl border flex items-center justify-center space-x-2 transition-all ${currentTheme === theme.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'}`}
              >
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: theme.color }}></div>
                <span className="text-sm font-medium dark:text-sanctuary-200">{theme.name}</span>
                {currentTheme === theme.id && <div className="absolute top-1 right-1 w-2 h-2 bg-primary-600 rounded-full"></div>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Background Patterns */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Background Patterns</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Select a background pattern for your wallet</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Static */}
          <div>
            <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-3 block">Static Backgrounds</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {staticBackgrounds.map(bg => (
                <button
                  key={bg.id}
                  onClick={() => updatePreferences({ background: bg.id })}
                  className={`relative p-3 rounded-xl border flex flex-col items-center justify-center text-center transition-all h-20 ${currentBg === bg.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'}`}
                >
                  <bg.icon className={`w-5 h-5 mb-2 ${currentBg === bg.id ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
                  <span className={`text-[10px] font-medium ${currentBg === bg.id ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-500'}`}>{bg.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Animated */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center space-x-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary-500" />
              <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Animated Backgrounds</label>
            </div>
            <p className="text-xs text-sanctuary-500 mb-3">Canvas-based animations that bring your wallet to life</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {animatedBackgrounds.map(bg => (
                <button
                  key={bg.id}
                  onClick={() => updatePreferences({ background: bg.id })}
                  className={`relative p-3 rounded-xl border flex flex-col items-center justify-center text-center transition-all h-20 ${currentBg === bg.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'}`}
                >
                  <bg.icon className={`w-5 h-5 mb-2 ${currentBg === bg.id ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
                  <span className={`text-[10px] font-medium ${currentBg === bg.id ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-500'}`}>{bg.name}</span>
                  <span className="absolute top-1 right-1">
                    <Sparkles className="w-3 h-3 text-primary-400" />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Time-Based / Seasonal */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-primary-500" />
                <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Seasonal Backgrounds</label>
              </div>
              {/* Toggle Switch */}
              <button
                onClick={() => {
                  const isCurrentlySeasonal = currentBg === seasonalBackground;
                  updatePreferences({
                    background: (isCurrentlySeasonal ? 'minimal' : seasonalBackground) as BackgroundOption
                  });
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  currentBg === seasonalBackground
                    ? 'bg-primary-500'
                    : 'bg-sanctuary-300 dark:bg-sanctuary-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    currentBg === seasonalBackground ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Current Season Display */}
            <div className="flex items-center p-3 surface-secondary rounded-xl mb-4">
              <div className="flex items-center space-x-3">
                {(() => {
                  const SeasonIcon = seasonIcons[currentSeason];
                  return <SeasonIcon className="w-5 h-5 text-primary-500" />;
                })()}
                <div>
                  <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    {themeRegistry.getSeasonName()}
                  </div>
                  <div className="text-xs text-sanctuary-500">
                    {animatedBackgrounds.find(b => b.id === seasonalBackground)?.name || seasonalBackground}
                  </div>
                </div>
              </div>
            </div>

            {/* Season Preview */}
            <div className="grid grid-cols-4 gap-2">
              {(['spring', 'summer', 'fall', 'winter'] as const).map(season => {
                const SeasonIcon = seasonIcons[season];
                const isCurrentSeason = season === currentSeason;
                const seasonBg = season === 'spring' ? 'sakura-petals'
                  : season === 'summer' ? 'fireflies'
                  : season === 'fall' ? 'falling-leaves'
                  : 'snowfall';

                return (
                  <button
                    key={season}
                    onClick={() => updatePreferences({ background: seasonBg as BackgroundOption })}
                    className={`relative p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all h-16 ${
                      isCurrentSeason
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500'
                        : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'
                    }`}
                  >
                    <SeasonIcon className={`w-4 h-4 mb-1 ${isCurrentSeason ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
                    <span className={`text-[10px] font-medium capitalize ${isCurrentSeason ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-500'}`}>
                      {season}
                    </span>
                    {isCurrentSeason && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-primary-500 rounded-full flex items-center justify-center">
                        <Check className="w-2 h-2 text-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Visual Settings */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Visual Settings</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Adjust appearance settings</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Dark Mode Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Dark Mode</span>
            <button
              onClick={() => updatePreferences({ darkMode: !isDark })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${isDark ? 'bg-primary-600' : 'bg-sanctuary-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDark ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Background Contrast */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Contrast className="w-4 h-4 text-sanctuary-500" />
                <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Background Contrast</span>
              </div>
              <span className="text-xs text-sanctuary-500">
                {(() => {
                  const level = user?.preferences?.contrastLevel ?? 0;
                  if (level === 0) return 'Default';
                  if (level === -2) return 'Much lighter';
                  if (level === -1) return 'Lighter';
                  if (level === 1) return 'Darker';
                  if (level === 2) return 'Much darker';
                  return 'Default';
                })()}
              </span>
            </div>
            <input
              type="range"
              min="-2"
              max="2"
              step="1"
              value={user?.preferences?.contrastLevel ?? 0}
              onChange={(e) => updatePreferences({ contrastLevel: parseInt(e.target.value, 10) })}
              className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
            />
          </div>

          {/* Pattern Visibility */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-sanctuary-500" />
                <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Pattern Visibility</span>
              </div>
              <span className="text-xs text-sanctuary-500 font-mono">
                {(user?.preferences?.patternOpacity ?? 50) === 0
                  ? 'Hidden'
                  : (user?.preferences?.patternOpacity ?? 50) === 50
                  ? 'Default'
                  : `${user?.preferences?.patternOpacity ?? 50}%`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={user?.preferences?.patternOpacity ?? 50}
              onChange={(e) => updatePreferences({ patternOpacity: parseInt(e.target.value, 10) })}
              className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// Display Tab Content
const DisplayTab: React.FC = () => {
  const { showFiat, toggleShowFiat, fiatCurrency, setFiatCurrency, unit, setUnit } = useCurrency();

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Display Preferences</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Configure how amounts are displayed</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Bitcoin Unit */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Bitcoin Unit</label>
              <p className="text-sm text-sanctuary-500">Choose between Sats (Integers) or BTC (Decimal).</p>
            </div>
            <div className="flex items-center surface-secondary rounded-lg p-1">
              <button
                onClick={() => setUnit('sats')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${unit === 'sats' ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
              >
                Sats
              </button>
              <button
                onClick={() => setUnit('btc')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${unit === 'btc' ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
              >
                BTC
              </button>
            </div>
          </div>

          {/* Show Fiat */}
          <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Show Fiat Equivalent</label>
              <p className="text-sm text-sanctuary-500">Display {fiatCurrency} value alongside Bitcoin amounts.</p>
            </div>
            <button
              onClick={toggleShowFiat}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${showFiat ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${showFiat ? 'translate-x-7' : 'translate-x-1'}`}>
                <DollarSign className={`w-4 h-4 m-1 ${showFiat ? 'text-primary-600' : 'text-sanctuary-400'}`} />
              </span>
            </button>
          </div>

          {/* Fiat Currency */}
          <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Fiat Currency</label>
              <p className="text-sm text-sanctuary-500">Select your local currency.</p>
            </div>
            <div className="relative">
              <select
                value={fiatCurrency}
                onChange={(e) => setFiatCurrency(e.target.value as FiatCurrency)}
                className="appearance-none surface-muted border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 py-2 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="JPY">JPY (¥)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-sanctuary-500">
                <Globe className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Services Tab Content
const ServicesTab: React.FC = () => {
  const { priceProvider, setPriceProvider, availableProviders, refreshPrice, priceLoading, lastPriceUpdate, btcPrice, currencySymbol } = useCurrency();

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Price Provider</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Configure Bitcoin price data source</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-sanctuary-500 mb-1">Provider</label>
            <select
              value={priceProvider}
              onChange={(e) => setPriceProvider(e.target.value)}
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            >
              {availableProviders.map(provider => (
                <option key={provider} value={provider}>
                  {provider === 'auto' ? 'Auto (Aggregated from all sources)' : provider.charAt(0).toUpperCase() + provider.slice(1)}
                </option>
              ))}
            </select>
            <p className="text-xs text-sanctuary-400 mt-2">
              {priceProvider === 'auto'
                ? 'Using aggregated prices from multiple sources for maximum reliability.'
                : `Using ${priceProvider} as the exclusive price source.`}
            </p>
          </div>

          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-sanctuary-500">Current Bitcoin Price</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={refreshPrice}
                isLoading={priceLoading}
              >
                Refresh Price
              </Button>
            </div>
            <div className="surface-muted rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
              <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                {btcPrice !== null
                  ? `${currencySymbol}${btcPrice.toLocaleString(undefined, {maximumFractionDigits: 0})}`
                  : '-----'}
              </div>
              {lastPriceUpdate && (
                <div className="text-xs text-sanctuary-400 mt-1">
                  Last updated: {lastPriceUpdate.toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Notifications Tab Content
const NotificationsTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <NotificationSoundSettings />
      <TelegramSettings />
    </div>
  );
};

export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  return (
    <div className="max-w-2xl mx-auto animate-fade-in pb-12">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">System Settings</h2>
        <p className="text-sanctuary-500">Customize your Sanctuary experience</p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex space-x-1 surface-secondary rounded-xl p-1">
          {SETTINGS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
                  : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'appearance' && <AppearanceTab />}
        {activeTab === 'display' && <DisplayTab />}
        {activeTab === 'services' && <ServicesTab />}
        {activeTab === 'notifications' && <NotificationsTab />}
      </div>
    </div>
  );
};
