/**
 * Internationalization Service
 *
 * Provides translation functionality using i18next.
 * Supports English, Japanese, and Spanish locales.
 *
 * Note: This service is thread-safe. Locale is passed per-request
 * rather than stored as instance state to avoid race conditions.
 *
 * @module i18n/i18nService
 */

import i18next, { TFunction } from 'i18next';
import { createLogger } from '../utils/logger';
import type {
  II18nService,
  SupportedLocale,
  TranslationOptions,
  TranslationNamespace,
} from './types';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from './types';

// Import translation resources
import enErrors from './locales/en/errors.json';
import enValidation from './locales/en/validation.json';
import enNotifications from './locales/en/notifications.json';
import enCommon from './locales/en/common.json';
import jaErrors from './locales/ja/errors.json';
import jaValidation from './locales/ja/validation.json';
import jaNotifications from './locales/ja/notifications.json';
import jaCommon from './locales/ja/common.json';
import esErrors from './locales/es/errors.json';
import esValidation from './locales/es/validation.json';
import esNotifications from './locales/es/notifications.json';
import esCommon from './locales/es/common.json';

const log = createLogger('I18n');

/**
 * Extended translation options with locale
 */
export interface TranslateOptions extends TranslationOptions {
  locale?: SupportedLocale;
}

/**
 * I18n service implementation
 *
 * Thread-safe: locale is passed per-request, not stored as instance state.
 */
class I18nService implements II18nService {
  private t!: TFunction;
  private initialized = false;

  /**
   * Initialize i18next
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await i18next.init({
      lng: DEFAULT_LOCALE,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES,

      // Namespaces
      ns: ['errors', 'validation', 'notifications', 'common'],
      defaultNS: 'common',

      // Resources (bundled for simplicity)
      resources: {
        en: {
          errors: enErrors,
          validation: enValidation,
          notifications: enNotifications,
          common: enCommon,
        },
        ja: {
          errors: jaErrors,
          validation: jaValidation,
          notifications: jaNotifications,
          common: jaCommon,
        },
        es: {
          errors: esErrors,
          validation: esValidation,
          notifications: esNotifications,
          common: esCommon,
        },
      },

      // Options
      interpolation: {
        escapeValue: false, // Not needed for API responses
      },

      // Return key if translation not found
      returnNull: false,
      returnEmptyString: false,
    });

    this.t = i18next.t.bind(i18next);
    this.initialized = true;

    log.info('I18n service initialized', {
      defaultLocale: DEFAULT_LOCALE,
      supportedLocales: SUPPORTED_LOCALES,
    });
  }

  /**
   * Translate a key with explicit locale (thread-safe)
   *
   * @param key - Translation key or namespaced key (e.g., "errors:notFound")
   * @param options - Interpolation values and locale
   */
  translate(key: string, options?: TranslateOptions): string;
  translate(namespace: TranslationNamespace, key: string, options?: TranslateOptions): string;
  translate(
    keyOrNamespace: string | TranslationNamespace,
    keyOrOptions?: string | TranslateOptions,
    options?: TranslateOptions
  ): string {
    if (!this.initialized) {
      log.warn('I18n not initialized, returning key');
      return typeof keyOrOptions === 'string' ? keyOrOptions : keyOrNamespace;
    }

    // Determine if namespace was provided
    let fullKey: string;
    let interpolation: TranslateOptions | undefined;

    if (typeof keyOrOptions === 'string') {
      // namespace:key form
      fullKey = `${keyOrNamespace}:${keyOrOptions}`;
      interpolation = options;
    } else {
      // key only
      fullKey = keyOrNamespace;
      interpolation = keyOrOptions;
    }

    // Extract locale from options, default to English
    const locale = interpolation?.locale ?? DEFAULT_LOCALE;

    const result = this.t(fullKey, {
      lng: locale,
      ...interpolation,
    });

    return result || fullKey;
  }

  /**
   * Get current locale (deprecated - use request-scoped locale)
   * @deprecated Use parseAcceptLanguage and pass locale to translate()
   */
  getLocale(): SupportedLocale {
    return DEFAULT_LOCALE;
  }

  /**
   * Set current locale (no-op for thread safety)
   * @deprecated Locale should be passed per-request to translate()
   */
  setLocale(_locale: SupportedLocale): void {
    // No-op: locale is now passed per-request to avoid race conditions
  }

  /**
   * Get all supported locales
   */
  getSupportedLocales(): SupportedLocale[] {
    return [...SUPPORTED_LOCALES];
  }

  /**
   * Check if locale is supported
   */
  isSupported(locale: string): locale is SupportedLocale {
    return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
  }

  /**
   * Parse Accept-Language header to get best matching locale
   *
   * @example
   * parseAcceptLanguage('ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7') // returns 'ja'
   * parseAcceptLanguage('es-MX,es;q=0.9,en;q=0.8') // returns 'es'
   * parseAcceptLanguage('fr-FR,fr;q=0.9') // returns 'en' (fallback)
   */
  parseAcceptLanguage(header: string | undefined): SupportedLocale {
    if (!header) return DEFAULT_LOCALE;

    // Parse Accept-Language header
    // Format: "en-US,en;q=0.9,ja;q=0.8"
    const languages = header
      .split(',')
      .map((part) => {
        const [lang, qValue] = part.trim().split(';q=');
        return {
          lang: lang.split('-')[0].toLowerCase(), // Get base language (en from en-US)
          q: qValue ? parseFloat(qValue) : 1.0,
        };
      })
      .sort((a, b) => b.q - a.q);

    // Find first supported language
    for (const { lang } of languages) {
      if (this.isSupported(lang)) {
        return lang;
      }
    }

    return DEFAULT_LOCALE;
  }
}

// Singleton instance
export const i18nService = new I18nService();

/**
 * Translate helper function
 *
 * @example
 * t('common:loading')
 * t('errors:notFound', { locale: 'ja' })
 * t('validation', 'required', { field: 'email', locale: 'es' })
 */
export function t(key: string, options?: TranslateOptions): string;
export function t(namespace: TranslationNamespace, key: string, options?: TranslateOptions): string;
export function t(
  keyOrNamespace: string | TranslationNamespace,
  keyOrOptions?: string | TranslateOptions,
  options?: TranslateOptions
): string {
  if (typeof keyOrOptions === 'string') {
    return i18nService.translate(keyOrNamespace as TranslationNamespace, keyOrOptions, options);
  }
  return i18nService.translate(keyOrNamespace, keyOrOptions);
}
