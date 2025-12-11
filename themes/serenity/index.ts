/**
 * Serenity Theme
 *
 * Light mode: Hawaii-inspired with warm sand backgrounds and ocean accents
 * Dark mode: Night sky with deep purple/black backgrounds and starlight accents
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const serenityTheme: ThemeDefinition = {
  id: 'serenity',
  name: 'Serenity',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Hawaii-inspired ocean theme transitioning to night sky in dark mode',

  colors: {
    light: {
      // Background colors (Warm sand tones)
      bg: {
        50: '#faf9f6',   // Off-white sand
        100: '#f5f0e1',  // Light tan
        200: '#e6dcc8',  // Wet sand
        300: '#d4c5a9',
        400: '#a89f91',  // Driftwood
        500: '#78716c',
        600: '#57534e',
        700: '#44403c',
        800: '#292524',
        900: '#1c1917',
        950: '#0c0a09',
      },

      // Primary colors (Ocean/teal/blue)
      primary: {
        50: '#f0fdfa',   // Foam
        100: '#ccfbf1',
        200: '#99fadd',  // Clear water
        300: '#5eead4',
        400: '#2dd4bf',
        500: '#0d9488',  // Deep teal accent
        600: '#0f766e',
        700: '#115e59',  // Text color
        800: '#134e4a',  // Button background
        900: '#042f2e',
        950: '#020617',
      },

      // Success colors (Seafoam)
      success: {
        50: '#effcf6',
        100: '#d1fae5',
        500: '#10b981',
        800: '#064e3b',
      },

      // Warning colors (Driftwood - neutral, no orange)
      warning: {
        50: '#fafaf9',
        100: '#f5f5f4',
        500: '#a8a29e',
        800: '#57534e',
      },
    },

    dark: {
      // Background colors (Night sky - deep purple/black)
      bg: {
        50: '#f3e8ff',   // Pale purple (lightest elements/text)
        100: '#e9d5ff',  // Light lavender
        200: '#d8b4fe',
        300: '#c084fc',
        400: '#a855f7',
        500: '#9333ea',
        600: '#7e22ce',
        700: '#6b21a8',
        800: '#3b0764',  // Panels (deep purple)
        900: '#2e1065',  // Main background (darker purple)
        950: '#0f0720',  // Abyss (black-purple)
      },

      // Primary colors (Starlight/neon violet)
      primary: {
        50: '#0f0720',
        100: '#2e1065',
        200: '#3b0764',
        300: '#581c87',
        400: '#7e22ce',
        500: '#a855f7',  // Bright violet accent
        600: '#c084fc',
        700: '#d8b4fe',
        800: '#e9d5ff',  // Text high contrast
        900: '#f3e8ff',
        950: '#ffffff',
      },

      // Success colors (Night green/emerald)
      success: {
        100: '#064e3b',
        500: '#34d399',  // Emerald 400
        800: '#d1fae5',
      },

      // Warning colors (Night pink/magenta)
      warning: {
        100: '#831843',
        500: '#e879f9',  // Fuchsia 400
        800: '#fdf4ff',
      },
    },
  },
};
