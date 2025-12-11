/**
 * Cyber Theme
 *
 * Synthwave/neon-inspired theme with purple/magenta accents,
 * cyan success indicators, and pink warnings
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const cyberTheme: ThemeDefinition = {
  id: 'cyber',
  name: 'Cyber',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Synthwave neon theme with vibrant purple and cyan accents',

  colors: {
    light: {
      // Background colors (inherit from default Sanctuary bg)
      bg: {
        50: '#fafafa',
        100: '#f4f4f5',
        200: '#e4e4e7',
        300: '#d4d4d8',
        400: '#a1a1aa',
        500: '#71717a',
        600: '#52525b',
        700: '#3f3f46',
        800: '#27272a',
        900: '#18181b',
        950: '#09090b',
      },

      // Primary colors (Purple/violet)
      primary: {
        50: '#faf5ff',
        100: '#f3e8ff',
        500: '#a855f7',   // Bright purple
        800: '#6b21a8',
        900: '#581c87',
      },

      // Success colors (Cyan)
      success: {
        500: '#0ea5e9',
      },

      // Warning colors (Hot pink)
      warning: {
        500: '#ec4899',
      },
    },

    dark: {
      // Background colors (same as light)
      bg: {
        50: '#fafafa',
        100: '#f4f4f5',
        200: '#e4e4e7',
        300: '#d4d4d8',
        400: '#a1a1aa',
        500: '#71717a',
        600: '#52525b',
        700: '#3f3f46',
        800: '#27272a',
        900: '#18181b',
        950: '#09090b',
      },

      // Primary colors (Purple/violet, adjusted for dark mode)
      primary: {
        50: '#3b0764',
        100: '#581c87',
        500: '#a855f7',   // Bright purple stays the same
        900: '#f3e8ff',
      },

      // Success colors (Cyan)
      success: {
        500: '#0ea5e9',
      },

      // Warning colors (Hot pink)
      warning: {
        500: '#ec4899',
      },
    },
  },
};
