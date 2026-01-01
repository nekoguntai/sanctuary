/**
 * Internationalization Middleware
 *
 * Detects and sets the locale for each request based on:
 * 1. X-Locale header (explicit)
 * 2. Accept-Language header (browser preference)
 * 3. Default locale (fallback)
 *
 * Thread-safe: locale is stored on request object, not in singleton state.
 *
 * @module middleware/i18n
 */

import { Request, Response, NextFunction } from 'express';
import { i18nService, TranslateOptions } from '../i18n/i18nService';
import type { SupportedLocale, TranslationNamespace } from '../i18n/types';

// Extend Express Request to include locale
declare global {
  namespace Express {
    interface Request {
      locale: SupportedLocale;
      t: {
        (key: string, options?: Omit<TranslateOptions, 'locale'>): string;
        (namespace: TranslationNamespace, key: string, options?: Omit<TranslateOptions, 'locale'>): string;
      };
    }
  }
}

/**
 * Middleware to detect and set request locale
 *
 * Thread-safe: stores locale on request object and provides
 * a request-scoped translate function.
 */
export function i18nMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Priority 1: Explicit X-Locale header
    const explicitLocale = req.headers['x-locale'] as string | undefined;
    if (explicitLocale && i18nService.isSupported(explicitLocale)) {
      req.locale = explicitLocale;
      attachTranslator(req);
      return next();
    }

    // Priority 2: Accept-Language header
    const acceptLanguage = req.headers['accept-language'];
    const parsedLocale = i18nService.parseAcceptLanguage(acceptLanguage);

    req.locale = parsedLocale;
    attachTranslator(req);

    next();
  };
}

/**
 * Attach a request-scoped translator function
 *
 * The translator function captures the request's locale so it doesn't
 * need to be passed explicitly on each call.
 */
function attachTranslator(req: Request): void {
  const locale = req.locale;

  // Create an overloaded translate function bound to this request's locale
  function translate(key: string, options?: Omit<TranslateOptions, 'locale'>): string;
  function translate(namespace: TranslationNamespace, key: string, options?: Omit<TranslateOptions, 'locale'>): string;
  function translate(
    keyOrNamespace: string | TranslationNamespace,
    keyOrOptions?: string | Omit<TranslateOptions, 'locale'>,
    options?: Omit<TranslateOptions, 'locale'>
  ): string {
    if (typeof keyOrOptions === 'string') {
      return i18nService.translate(keyOrNamespace as TranslationNamespace, keyOrOptions, { ...options, locale });
    }
    return i18nService.translate(keyOrNamespace, { ...keyOrOptions, locale });
  }

  req.t = translate;
}

/**
 * Get the locale from a request (for use in services)
 */
export function getRequestLocale(req: Request): SupportedLocale {
  return req.locale || 'en';
}
