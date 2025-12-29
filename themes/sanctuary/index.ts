/**
 * Sanctuary Theme
 *
 * Default theme with warm sand/tan tones in light mode
 * and charcoal/neutral grays in dark mode.
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sanctuaryTheme: ThemeDefinition = {
  id: 'sanctuary',
  name: 'Sanctuary',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Warm, neutral theme with earthy tones and matcha green accents',

  colors: {
    light: {
      // Background colors (Zinc/Neutral)
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

      // Primary colors (Warm sand/tan)
      primary: {
        50: '#fdfbf7',
        100: '#f5f2eb',
        200: '#e6e0d4',
        300: '#d4cbb8',
        400: '#a39e93',
        500: '#7d7870',
        600: '#5c5852',
        700: '#45423e',
        800: '#2e2c2a',
        900: '#1c1c1e',
        950: '#0f0f10',
      },

      // Success colors (Matcha green)
      success: {
        50: '#f4f8f5',
        100: '#e2ede5',
        200: '#c5dccb',
        500: '#628b6b',
        600: '#4a6e53',
        700: '#3d5944',
        800: '#334839',
        900: '#2b3b30',
        950: '#17211b',
      },

      // Warning colors (Zen gold)
      warning: {
        50: '#fcf9f4',
        100: '#f8f1e1',
        200: '#efe0c0',
        500: '#b59056',
        600: '#96723e',
        700: '#795932',
        800: '#644a2d',
        900: '#533e28',
        950: '#2d2114',
      },

      // Sent colors (Violet/Purple for sent transactions)
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

      // Mainnet colors (Emerald/Green for mainnet network)
      mainnet: {
        50: '#ecfdf5',
        100: '#d1fae5',
        200: '#a7f3d0',
        300: '#6ee7b7',
        400: '#34d399',
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
        300: '#fcd34d',
        400: '#fbbf24',
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
        300: '#d8b4fe',
        400: '#c084fc',
        500: '#a855f7',
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
      },
    },

    dark: {
      // Background colors stay the same as light mode
      // (Tailwind handles the mapping automatically)
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

      // Primary colors (inverted for dark mode)
      primary: {
        50: '#1a1917',
        100: '#2b261f',
        200: '#453d30',
        300: '#6b5d46',
        400: '#968362',
        500: '#bfa57a',
        600: '#d4b483',
        700: '#e6dcc8',
        800: '#f2efe9',
        900: '#fdfbf7',
        950: '#ffffff',
      },

      // Success colors (inverted)
      success: {
        50: '#17211b',
        100: '#2b3b30',
        200: '#334839',
        500: '#628b6b',
        600: '#84a98c',
        700: '#9fc4a9',
        800: '#c5dccb',
        900: '#e2ede5',
        950: '#f4f8f5',
      },

      // Warning colors (inverted)
      warning: {
        50: '#2d2114',
        100: '#533e28',
        200: '#644a2d',
        500: '#b59056',
        600: '#d4b483',
        700: '#e3ca98',
        800: '#efe0c0',
        900: '#f8f1e1',
        950: '#fcf9f4',
      },

      // Sent colors (Violet/Purple for sent transactions - inverted)
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

      // Mainnet colors (Emerald/Green - inverted)
      mainnet: {
        50: '#022c22',
        100: '#064e3b',
        200: '#065f46',
        300: '#047857',
        400: '#059669',
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
        300: '#b45309',
        400: '#d97706',
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
        300: '#7e22ce',
        400: '#9333ea',
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
