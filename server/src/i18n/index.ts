/**
 * Internationalization Module
 *
 * Provides translation functionality for the Sanctuary API.
 * Supports English (en), Japanese (ja), and Spanish (es) locales.
 *
 * @module i18n
 */

export { i18nService, t } from './i18nService';
export { i18nMiddleware, getRequestLocale } from '../middleware/i18n';

export type {
  SupportedLocale,
  TranslationOptions,
  TranslationNamespace,
  II18nService,
} from './types';

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from './types';
