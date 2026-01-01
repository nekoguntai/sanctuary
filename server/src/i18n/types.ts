/**
 * Internationalization Types
 *
 * @module i18n/types
 */

/**
 * Supported locales
 */
export type SupportedLocale = 'en' | 'ja' | 'es';

/**
 * Default locale
 */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * All supported locales
 */
export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'ja', 'es'];

/**
 * Translation options
 */
export interface TranslationOptions {
  /**
   * Interpolation values
   */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Translation namespaces
 */
export type TranslationNamespace = 'errors' | 'validation' | 'notifications' | 'common';

/**
 * i18n service interface
 */
export interface II18nService {
  /**
   * Translate a key
   */
  translate(key: string, options?: TranslationOptions): string;

  /**
   * Translate with a specific namespace
   */
  translate(namespace: TranslationNamespace, key: string, options?: TranslationOptions): string;

  /**
   * Get current locale
   */
  getLocale(): SupportedLocale;

  /**
   * Set current locale
   */
  setLocale(locale: SupportedLocale): void;

  /**
   * Get all supported locales
   */
  getSupportedLocales(): SupportedLocale[];

  /**
   * Check if locale is supported
   */
  isSupported(locale: string): locale is SupportedLocale;

  /**
   * Get locale from Accept-Language header
   */
  parseAcceptLanguage(header: string | undefined): SupportedLocale;
}
