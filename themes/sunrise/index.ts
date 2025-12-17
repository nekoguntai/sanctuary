/**
 * Sunrise/Sunset Theme
 *
 * Light mode: Sunrise palette with white backgrounds and warm coral/peach/golden accents
 * Dark mode: Pastel sunset palette with deep purple/blue backgrounds and soft warm pastels
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sunriseTheme: ThemeDefinition = {
  id: 'sunrise',
  name: 'Sun+rise/set',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Sunrise warmth in light mode, pastel sunset serenity in dark mode',

  colors: {
    light: {
      // Background colors (clean whites with warm undertones)
      bg: {
        50: '#fffcfa',   // Warmest white
        100: '#fff8f3',
        200: '#ffefe3',
        300: '#ffe4d1',
        400: '#c9b8a8',  // Warm gray
        500: '#9a8b7c',
        600: '#7a6d60',
        700: '#5d5249',
        800: '#3d3530',
        900: '#261f1b',
        950: '#141110',
      },

      // Primary colors (Sunrise coral/peach)
      primary: {
        50: '#fff5f2',
        100: '#ffe8e0',
        200: '#ffd4c4',
        300: '#ffb59a',
        400: '#ff9670',   // Coral
        500: '#e87850',   // Warm coral
        600: '#d45d3a',
        700: '#b04528',
        800: '#8c3820',
        900: '#6b2c1a',
        950: '#3a150c',
      },

      // Success colors (Golden sunrise/honey)
      success: {
        50: '#fffbeb',
        100: '#fff3c4',
        200: '#ffe588',
        500: '#e6a317',   // Golden honey
        600: '#cc8a0f',
        700: '#a86c0c',
        800: '#88550d',
        900: '#704610',
        950: '#402505',
      },

      // Warning colors (Sunrise pink/rose)
      warning: {
        50: '#fff5f7',
        100: '#ffe0e8',
        200: '#ffc7d6',
        500: '#e85d8c',   // Rose pink
        600: '#d4426f',
        700: '#b0315a',
        800: '#8c294a',
        900: '#6b223c',
        950: '#3a101f',
      },
    },

    dark: {
      // Background colors (Deep sunset purples/blues)
      bg: {
        50: '#faf8fc',
        100: '#f3f0f7',
        200: '#e8e3ef',
        300: '#d4cce0',
        400: '#a99fc0',   // Dusty lavender
        500: '#7d7498',
        600: '#5e566e',
        700: '#433d50',
        800: '#2a2635',   // Deep purple-blue
        900: '#1a1722',   // Night purple
        950: '#0d0b11',
      },

      // Primary colors (Pastel peach/coral for dark mode)
      primary: {
        50: '#2a1f1d',
        100: '#3d2e29',
        200: '#5c4239',
        300: '#8c6050',
        400: '#c48872',
        500: '#e8a890',   // Soft pastel coral
        600: '#f2c4b3',
        700: '#f8dcd0',
        800: '#fceee8',
        900: '#fef7f4',
        950: '#fffcfb',
      },

      // Success colors (Pastel golden/amber)
      success: {
        50: '#2a2415',
        100: '#3d351f',
        200: '#5c4d2a',
        500: '#d4a84a',   // Soft golden
        600: '#e8c66e',
        700: '#f2d98f',
        800: '#f8e8b5',
        900: '#fcf3d8',
        950: '#fef9ec',
      },

      // Warning colors (Pastel rose/pink)
      warning: {
        50: '#2a1a20',
        100: '#3d2730',
        200: '#5c3848',
        500: '#d4668a',   // Soft rose
        600: '#e88aa8',
        700: '#f2adc2',
        800: '#f8cfd9',
        900: '#fce8ee',
        950: '#fef5f7',
      },
    },
  },
};
