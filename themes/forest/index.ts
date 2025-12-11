/**
 * Forest Theme
 *
 * Nature-inspired green theme with lime accents and amber warnings
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const forestTheme: ThemeDefinition = {
  id: 'forest',
  name: 'Forest',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Fresh green nature theme with vibrant accents',

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

      // Primary colors (Green)
      primary: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        300: '#86efac',
        400: '#4ade80',
        500: '#22c55e',   // Main green
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
        900: '#14532d',
        950: '#052e16',
      },

      // Success colors (Lime)
      success: {
        500: '#84cc16',
      },

      // Warning colors (Amber)
      warning: {
        500: '#f59e0b',
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

      // Primary colors (Green, inverted shades)
      primary: {
        50: '#052e16',
        100: '#14532d',
        500: '#22c55e',   // Main green stays the same
        900: '#dcfce7',
        950: '#f0fdf4',
      },

      // Success colors (Lime)
      success: {
        500: '#84cc16',
      },

      // Warning colors (Amber)
      warning: {
        500: '#f59e0b',
      },
    },
  },
};
