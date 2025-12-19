/**
 * Midnight Theme
 *
 * Sophisticated dark theme with silver/platinum accents.
 * Deep indigo and charcoal backgrounds with cool metallic highlights.
 * Perfect for users who prefer darker interfaces with elegant contrast.
 *
 * Light mode: Cool silver/platinum with deep accents
 * Dark mode: True midnight with luminous silver highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const midnightTheme: ThemeDefinition = {
  id: 'midnight',
  name: 'Midnight',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Sophisticated silver and deep indigo for elegant darkness',

  colors: {
    light: {
      // Background colors (Cool silver/platinum grays)
      bg: {
        50: '#fafafa',   // Pure silver-white
        100: '#f5f5f5',  // Light platinum
        200: '#e5e5e5',  // Soft silver
        300: '#d4d4d4',  // Medium silver
        400: '#a3a3a3',  // Gray
        500: '#737373',  // Dark gray
        600: '#525252',  // Charcoal
        700: '#404040',  // Dark charcoal
        800: '#262626',  // Near black
        900: '#171717',  // Deep black
        950: '#0a0a0a',  // True black
      },

      // Primary colors (Deep indigo/violet)
      primary: {
        50: '#eef2ff',   // Indigo-50: Palest indigo
        100: '#e0e7ff',  // Indigo-100: Light indigo
        200: '#c7d2fe',  // Indigo-200: Soft indigo
        300: '#a5b4fc',  // Indigo-300: Medium indigo
        400: '#818cf8',  // Indigo-400: Bright indigo
        500: '#6366f1',  // Indigo-500: True indigo (main)
        600: '#4f46e5',  // Indigo-600: Deep indigo
        700: '#4338ca',  // Indigo-700: Dark indigo
        800: '#3730a3',  // Indigo-800: Very dark indigo
        900: '#312e81',  // Indigo-900: Midnight indigo
        950: '#1e1b4b',  // Indigo-950: Darkest
      },

      // Success colors (Cool cyan/teal)
      success: {
        50: '#ecfeff',
        100: '#cffafe',
        200: '#a5f3fc',
        500: '#06b6d4',  // Cyan-500: Cool success
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
        900: '#164e63',
        950: '#083344',
      },

      // Warning colors (Amber/gold for contrast)
      warning: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        500: '#f59e0b',  // Amber-500: Warm gold
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
        950: '#451a03',
      },
    },

    dark: {
      // Background colors (True midnight - deep indigo-black)
      bg: {
        50: '#fafafa',   // Light for text
        100: '#f5f5f5',
        200: '#e5e5e5',
        300: '#d4d4d4',
        400: '#a3a3a3',
        500: '#737373',
        600: '#525252',
        700: '#2d2d3a',  // Indigo-tinted charcoal
        800: '#1a1a24',  // Deep midnight panels
        900: '#0f0f14',  // True midnight background
        950: '#050508',  // Absolute darkness
      },

      // Primary colors (Luminous silver/platinum)
      primary: {
        50: '#18181b',   // Dark zinc (inverted)
        100: '#27272a',
        200: '#3f3f46',
        300: '#52525b',
        400: '#71717a',
        500: '#a1a1aa',  // Silver-500: Luminous silver
        600: '#d4d4d8',
        700: '#e4e4e7',
        800: '#f4f4f5',
        900: '#fafafa',
        950: '#ffffff',
      },

      // Success colors (Bright cyan for visibility)
      success: {
        50: '#083344',
        100: '#164e63',
        200: '#155e75',
        500: '#22d3ee',  // Cyan-400: Bright cyan
        600: '#67e8f9',
        700: '#a5f3fc',
        800: '#cffafe',
        900: '#ecfeff',
        950: '#f0fdff',
      },

      // Warning colors (Gold/amber accent for warmth)
      warning: {
        50: '#422006',
        100: '#78350f',
        200: '#92400e',
        500: '#fbbf24',  // Amber-400: Warm gold
        600: '#fcd34d',
        700: '#fde68a',
        800: '#fef3c7',
        900: '#fffbeb',
        950: '#fefce8',
      },
    },
  },
};
