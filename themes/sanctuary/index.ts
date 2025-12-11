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
    },
  },
};
