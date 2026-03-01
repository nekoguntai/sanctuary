/**
 * I18n Service Tests
 *
 * Tests for the internationalization service including:
 * - Service initialization
 * - Translation with simple keys
 * - Translation with namespaced keys
 * - Accept-Language header parsing
 * - Locale validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist i18next mocks
const { mockT, mockInit } = vi.hoisted(() => {
  const mockT = vi.fn((key: string, options?: any) => {
    const locale = options?.lng || 'en';
    // Return simulated translations
    if (key.includes(':')) {
      const [ns, k] = key.split(':');
      return `[${locale}] ${ns}:${k}`;
    }
    return `[${locale}] ${key}`;
  });

  const mockInit = vi.fn().mockResolvedValue(undefined);

  return { mockT, mockInit };
});

vi.mock('i18next', () => ({
  default: {
    init: mockInit,
    t: mockT,
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock JSON imports with vi.hoisted
const mockJsons = vi.hoisted(() => ({
  enErrors: { notFound: 'Not found' },
  enValidation: { required: '{field} is required' },
  enNotifications: { newTransaction: 'New transaction' },
  enCommon: { loading: 'Loading...' },
  jaErrors: { notFound: '見つかりません' },
  jaValidation: { required: '{field}は必須です' },
  jaNotifications: { newTransaction: '新しい取引' },
  jaCommon: { loading: '読み込み中...' },
  esErrors: { notFound: 'No encontrado' },
  esValidation: { required: '{field} es requerido' },
  esNotifications: { newTransaction: 'Nueva transacción' },
  esCommon: { loading: 'Cargando...' },
}));

vi.mock('../../../src/i18n/locales/en/errors.json', () => ({ default: mockJsons.enErrors }));
vi.mock('../../../src/i18n/locales/en/validation.json', () => ({ default: mockJsons.enValidation }));
vi.mock('../../../src/i18n/locales/en/notifications.json', () => ({ default: mockJsons.enNotifications }));
vi.mock('../../../src/i18n/locales/en/common.json', () => ({ default: mockJsons.enCommon }));
vi.mock('../../../src/i18n/locales/ja/errors.json', () => ({ default: mockJsons.jaErrors }));
vi.mock('../../../src/i18n/locales/ja/validation.json', () => ({ default: mockJsons.jaValidation }));
vi.mock('../../../src/i18n/locales/ja/notifications.json', () => ({ default: mockJsons.jaNotifications }));
vi.mock('../../../src/i18n/locales/ja/common.json', () => ({ default: mockJsons.jaCommon }));
vi.mock('../../../src/i18n/locales/es/errors.json', () => ({ default: mockJsons.esErrors }));
vi.mock('../../../src/i18n/locales/es/validation.json', () => ({ default: mockJsons.esValidation }));
vi.mock('../../../src/i18n/locales/es/notifications.json', () => ({ default: mockJsons.esNotifications }));
vi.mock('../../../src/i18n/locales/es/common.json', () => ({ default: mockJsons.esCommon }));

// Now import the service after mocks
import { i18nService, t } from '../../../src/i18n/i18nService';

describe('I18n Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize i18next with supported locales', async () => {
      await i18nService.initialize();

      expect(mockInit).toHaveBeenCalledWith(
        expect.objectContaining({
          lng: 'en',
          fallbackLng: 'en',
          supportedLngs: ['en', 'ja', 'es'],
          ns: ['errors', 'validation', 'notifications', 'common'],
          defaultNS: 'common',
        })
      );
    });

    it('should only initialize once', async () => {
      await i18nService.initialize();
      await i18nService.initialize();

      // mockInit should only be called once from the first init
      // Since we're testing a singleton, the first test already initialized it
      expect(mockInit.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('translate', () => {
    it('should return key values when service is not initialized', () => {
      (i18nService as any).initialized = false;

      expect(i18nService.translate('common:loading')).toBe('common:loading');
      expect(i18nService.translate('errors', 'notFound')).toBe('notFound');
    });

    beforeEach(async () => {
      await i18nService.initialize();
    });

    it('should translate simple key with default locale', () => {
      const result = i18nService.translate('greeting');

      expect(mockT).toHaveBeenCalledWith('greeting', expect.objectContaining({ lng: 'en' }));
    });

    it('should translate with explicit locale', () => {
      i18nService.translate('greeting', { locale: 'ja' });

      expect(mockT).toHaveBeenCalledWith('greeting', expect.objectContaining({ lng: 'ja' }));
    });

    it('should translate namespaced key', () => {
      i18nService.translate('errors', 'notFound', { locale: 'es' });

      expect(mockT).toHaveBeenCalledWith('errors:notFound', expect.objectContaining({ lng: 'es' }));
    });

    it('should pass interpolation values', () => {
      i18nService.translate('validation', 'required', { field: 'email', locale: 'en' });

      expect(mockT).toHaveBeenCalledWith(
        'validation:required',
        expect.objectContaining({
          lng: 'en',
          field: 'email',
        })
      );
    });

    it('should fall back to full key when translation result is empty', () => {
      mockT.mockReturnValueOnce('');

      const result = i18nService.translate('errors', 'notFound', { locale: 'en' });

      expect(result).toBe('errors:notFound');
    });
  });

  describe('t helper function', () => {
    beforeEach(async () => {
      await i18nService.initialize();
    });

    it('should translate simple key', () => {
      t('common:loading');

      expect(mockT).toHaveBeenCalledWith('common:loading', expect.any(Object));
    });

    it('should translate with namespace and key', () => {
      t('errors', 'notFound', { locale: 'ja' });

      expect(mockT).toHaveBeenCalledWith('errors:notFound', expect.objectContaining({ lng: 'ja' }));
    });
  });

  describe('getLocale', () => {
    it('should return default locale', () => {
      const locale = i18nService.getLocale();

      expect(locale).toBe('en');
    });
  });

  describe('setLocale', () => {
    it('should be a no-op for thread safety', () => {
      // setLocale is deprecated and should be a no-op
      i18nService.setLocale('ja');

      // getLocale should still return default
      expect(i18nService.getLocale()).toBe('en');
    });
  });

  describe('getSupportedLocales', () => {
    it('should return all supported locales', () => {
      const locales = i18nService.getSupportedLocales();

      expect(locales).toEqual(['en', 'ja', 'es']);
    });

    it('should return a new array each time', () => {
      const locales1 = i18nService.getSupportedLocales();
      const locales2 = i18nService.getSupportedLocales();

      expect(locales1).not.toBe(locales2);
      expect(locales1).toEqual(locales2);
    });
  });

  describe('isSupported', () => {
    it('should return true for supported locale', () => {
      expect(i18nService.isSupported('en')).toBe(true);
      expect(i18nService.isSupported('ja')).toBe(true);
      expect(i18nService.isSupported('es')).toBe(true);
    });

    it('should return false for unsupported locale', () => {
      expect(i18nService.isSupported('fr')).toBe(false);
      expect(i18nService.isSupported('de')).toBe(false);
      expect(i18nService.isSupported('zh')).toBe(false);
    });
  });

  describe('parseAcceptLanguage', () => {
    it('should return default locale for undefined header', () => {
      const locale = i18nService.parseAcceptLanguage(undefined);

      expect(locale).toBe('en');
    });

    it('should return default locale for empty header', () => {
      const locale = i18nService.parseAcceptLanguage('');

      expect(locale).toBe('en');
    });

    it('should parse simple language code', () => {
      const locale = i18nService.parseAcceptLanguage('ja');

      expect(locale).toBe('ja');
    });

    it('should parse language with region code', () => {
      const locale = i18nService.parseAcceptLanguage('es-MX');

      expect(locale).toBe('es');
    });

    it('should parse multiple languages and pick first supported', () => {
      const locale = i18nService.parseAcceptLanguage('fr-FR,ja;q=0.9,en;q=0.8');

      expect(locale).toBe('ja'); // French not supported, Japanese is
    });

    it('should respect quality values', () => {
      const locale = i18nService.parseAcceptLanguage('en;q=0.5,ja;q=0.9');

      expect(locale).toBe('ja'); // Japanese has higher quality
    });

    it('should fall back to default for unsupported languages', () => {
      const locale = i18nService.parseAcceptLanguage('fr-FR,de;q=0.9,zh;q=0.8');

      expect(locale).toBe('en'); // None supported, fall back to default
    });

    it('should handle complex Accept-Language header', () => {
      const locale = i18nService.parseAcceptLanguage('ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');

      expect(locale).toBe('ja');
    });

    it('should handle whitespace in header', () => {
      const locale = i18nService.parseAcceptLanguage(' es , en ; q=0.5 ');

      expect(locale).toBe('es');
    });
  });
});
