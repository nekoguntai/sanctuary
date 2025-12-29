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

      // Sent colors (Violet)
      sent: {
        50: '#f5f3ff',
        100: '#ede9fe',
        200: '#ddd6fe',
        500: '#8b5cf6',
        600: '#7c3aed',
        700: '#6d28d9',
        800: '#5b21b6',
        900: '#4c1d95',
        950: '#2e1065',
      },

      // Mainnet colors (Emerald - matching forest green theme)
      mainnet: {
        50: '#ecfdf5',
        100: '#d1fae5',
        200: '#a7f3d0',
        500: '#10b981',
        600: '#059669',
        700: '#047857',
        800: '#065f46',
        900: '#064e3b',
        950: '#022c22',
      },

      // Testnet colors (Amber)
      testnet: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        500: '#f59e0b',
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
        950: '#451a03',
      },

      // Signet colors (Purple)
      signet: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        500: '#a855f7',
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
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

      // Sent colors (Violet - inverted)
      sent: {
        50: '#2e1065',
        100: '#4c1d95',
        200: '#5b21b6',
        500: '#8b5cf6',
        600: '#a78bfa',
        700: '#c4b5fd',
        800: '#ddd6fe',
        900: '#ede9fe',
        950: '#f5f3ff',
      },

      // Mainnet colors (Emerald - inverted)
      mainnet: {
        50: '#022c22',
        100: '#064e3b',
        200: '#065f46',
        500: '#10b981',
        600: '#34d399',
        700: '#6ee7b7',
        800: '#a7f3d0',
        900: '#d1fae5',
        950: '#ecfdf5',
      },

      // Testnet colors (Amber - inverted)
      testnet: {
        50: '#451a03',
        100: '#78350f',
        200: '#92400e',
        500: '#f59e0b',
        600: '#fbbf24',
        700: '#fcd34d',
        800: '#fde68a',
        900: '#fef3c7',
        950: '#fffbeb',
      },

      // Signet colors (Purple - inverted)
      signet: {
        50: '#3b0764',
        100: '#581c87',
        200: '#6b21a8',
        500: '#a855f7',
        600: '#c084fc',
        700: '#d8b4fe',
        800: '#e9d5ff',
        900: '#f3e8ff',
        950: '#faf5ff',
      },
    },
  },
};
