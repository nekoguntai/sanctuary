/**
 * useUserPreference - Abstracts server vs localStorage preference fallback
 *
 * When user is logged in: reads/writes to server-side user preferences via UserContext
 * When not logged in: falls back to localStorage
 *
 * Supports dot-notation keys for nested preferences (e.g., 'viewSettings.wallets.layout').
 *
 * @example
 * // Simple top-level preference
 * const [darkMode, setDarkMode] = useUserPreference('darkMode', false);
 *
 * // Nested preference with dot notation
 * const [layout, setLayout] = useUserPreference('viewSettings.wallets.layout', 'grid');
 */

import { useState, useCallback, useEffect } from 'react';
import { useCurrentUser, useUserPreferences } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';

const log = createLogger('useUserPreference');

const STORAGE_PREFIX = 'sanctuary_pref_';

/**
 * Get a nested value from an object using a dot-notation path.
 * Returns undefined if any segment is missing.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Build a partial preferences object from a dot-notation path and value.
 * e.g., buildNestedUpdate('viewSettings.wallets.layout', 'grid', existingPrefs)
 * returns { viewSettings: { ...existingViewSettings, wallets: { ...existingWallets, layout: 'grid' } } }
 */
function buildNestedUpdate(
  path: string,
  value: unknown,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const keys = path.split('.');

  if (keys.length === 1) {
    return { [keys[0]]: value };
  }

  const [first, ...rest] = keys;
  const existingChild = (existing[first] as Record<string, unknown>) ?? {};

  return {
    [first]: {
      ...existingChild,
      ...buildNestedUpdate(rest.join('.'), value, existingChild),
    },
  };
}

export function useUserPreference<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const user = useCurrentUser();
  const { preferences, updatePreferences } = useUserPreferences();
  const isLoggedIn = !!user;

  // Read initial value from localStorage for unauthenticated fallback
  const [localValue, setLocalValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch (err) {
      log.debug('Failed to read localStorage preference', { key, error: err });
    }
    return defaultValue;
  });

  // Derive the current value: server preferences take priority when logged in
  const serverValue = preferences
    ? (getNestedValue(preferences as unknown as Record<string, unknown>, key) as T | undefined)
    : undefined;

  const currentValue = isLoggedIn
    ? (serverValue !== undefined ? serverValue : defaultValue)
    : localValue;

  // Sync localStorage when the local value changes (unauthenticated mode)
  useEffect(() => {
    if (!isLoggedIn) {
      try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(localValue));
      } catch (err) {
        log.debug('Failed to write localStorage preference', { key, error: err });
      }
    }
  }, [isLoggedIn, localValue, key]);

  const setValue = useCallback(
    (newValue: T) => {
      if (isLoggedIn && preferences) {
        const update = buildNestedUpdate(
          key,
          newValue,
          preferences as unknown as Record<string, unknown>
        );
        updatePreferences(update);
      } else {
        setLocalValue(newValue);
      }
    },
    [isLoggedIn, preferences, key, updatePreferences]
  );

  return [currentValue, setValue];
}
