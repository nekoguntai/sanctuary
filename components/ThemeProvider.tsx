/**
 * ThemeProvider Component
 *
 * React component that manages theme application based on user preferences.
 * Works in conjunction with UserContext to apply themes dynamically.
 */

import React, { useEffect } from 'react';
import { themeRegistry } from '../themes';
import type { ThemeOption, BackgroundOption } from '../types';

interface ThemeProviderProps {
  theme: ThemeOption;
  background: BackgroundOption;
  darkMode: boolean;
  children: React.ReactNode;
}

export function ThemeProvider({ theme, background, darkMode, children }: ThemeProviderProps) {
  useEffect(() => {
    // Apply dark mode class
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Apply theme
    const mode = darkMode ? 'dark' : 'light';
    themeRegistry.applyTheme(theme, mode);

    // Apply background pattern
    themeRegistry.applyPattern(background, theme);

    // Add smooth transition
    document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';

  }, [theme, background, darkMode]);

  return <>{children}</>;
}
