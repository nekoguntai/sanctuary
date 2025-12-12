/**
 * Serenity Theme
 *
 * Light mode: Hawaii-inspired with warm sand backgrounds and ocean accents
 * Dark mode: Starry night sky with deep indigo/blue backgrounds and starlight accents
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const serenityTheme: ThemeDefinition = {
  id: 'serenity',
  name: 'Serenity',
  author: 'Sanctuary Wallet Team',
  version: '1.1.0',
  description: 'Ocean serenity in light mode, starry night sky in dark mode',

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
      // Background colors (Starry night sky - deep blues to black)
      bg: {
        50: '#e0e7ff',   // Pale starlight blue
        100: '#c7d2fe',  // Light periwinkle
        200: '#a5b4fc',  // Soft indigo
        300: '#818cf8',  // Twilight violet
        400: '#6366f1',  // Evening indigo
        500: '#4f46e5',  // Deep twilight
        600: '#3730a3',  // Night indigo
        700: '#1e1b4b',  // Deep night blue
        800: '#0f0d2e',  // Midnight panels
        900: '#0a0919',  // Night sky background
        950: '#050510',  // Cosmic black
      },

      // Primary colors (Starlight - silver to bright blue)
      primary: {
        50: '#0c0a1a',   // Deep space
        100: '#1a1744',  // Dark nebula
        200: '#2d2a6e',  // Distant stars
        300: '#4338ca',  // Bright star core
        400: '#6366f1',  // Star glow
        500: '#818cf8',  // Bright starlight
        600: '#a5b4fc',  // Soft star shine
        700: '#c7d2fe',  // Pale starlight
        800: '#e0e7ff',  // Near-white glow
        900: '#eef2ff',  // Brightest star
        950: '#ffffff',  // Pure light
      },

      // Success colors (Aurora green)
      success: {
        50: '#052e16',
        100: '#064e3b',
        200: '#047857',
        500: '#34d399',  // Aurora green
        600: '#6ee7b7',
        700: '#a7f3d0',
        800: '#d1fae5',
        900: '#ecfdf5',
        950: '#f0fdf4',
      },

      // Warning colors (Nebula magenta/pink)
      warning: {
        50: '#2e1a47',
        100: '#4c1d95',
        200: '#6b21a8',
        500: '#c084fc',  // Nebula purple
        600: '#d8b4fe',
        700: '#e9d5ff',
        800: '#f3e8ff',
        900: '#faf5ff',
        950: '#fefcff',
      },
    },
  },
};
