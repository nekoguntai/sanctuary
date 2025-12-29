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

      // Sent colors (Neon violet)
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

      // Mainnet colors (Neon cyan for cyber)
      mainnet: {
        50: '#ecfeff',
        100: '#cffafe',
        200: '#a5f3fc',
        500: '#06b6d4',
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
        900: '#164e63',
        950: '#083344',
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

      // Signet colors (Hot pink for cyber)
      signet: {
        50: '#fdf2f8',
        100: '#fce7f3',
        200: '#fbcfe8',
        500: '#ec4899',
        600: '#db2777',
        700: '#be185d',
        800: '#9d174d',
        900: '#831843',
        950: '#500724',
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

      // Sent colors (Neon violet - inverted)
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

      // Mainnet colors (Neon cyan - inverted)
      mainnet: {
        50: '#083344',
        100: '#164e63',
        200: '#155e75',
        500: '#06b6d4',
        600: '#22d3ee',
        700: '#67e8f9',
        800: '#a5f3fc',
        900: '#cffafe',
        950: '#ecfeff',
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

      // Signet colors (Hot pink - inverted)
      signet: {
        50: '#500724',
        100: '#831843',
        200: '#9d174d',
        500: '#ec4899',
        600: '#f472b6',
        700: '#f9a8d4',
        800: '#fbcfe8',
        900: '#fce7f3',
        950: '#fdf2f8',
      },
    },
  },
};
