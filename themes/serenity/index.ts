/**
 * Serenity Theme
 *
 * Light mode: Tropical beach with sandy backgrounds, turquoise ocean, and palm greens
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
  description: 'Tropical beach in light mode, starry night sky in dark mode',

  colors: {
    light: {
      // Background colors (Warm tropical sand)
      bg: {
        50: '#fffdf8',   // Sun-bleached white
        100: '#fef8e8',  // Pale sand
        200: '#f5ead4',  // Warm beach sand
        300: '#e8d9b8',  // Golden sand
        400: '#c4b08a',  // Wet sand
        500: '#8a7a5c',  // Driftwood
        600: '#6b5d44',
        700: '#4d432f',
        800: '#332c1f',
        900: '#1f1a12',
        950: '#0f0d09',
      },

      // Primary colors (Tropical turquoise ocean)
      primary: {
        50: '#effffe',   // Seafoam white
        100: '#c8fffe',  // Shallow lagoon
        200: '#8ff7f5',  // Crystal clear water
        300: '#4fe8e8',  // Bright turquoise
        400: '#22d3d8',  // Tropical lagoon
        500: '#0ab4bc',  // Deep turquoise accent
        600: '#0891a0',  // Ocean blue
        700: '#0e7082',  // Deep water text
        800: '#155b6a',  // Button background
        900: '#164a55',
        950: '#082f38',
      },

      // Success colors (Tropical palm green)
      success: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        500: '#22c55e',  // Vibrant palm green
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
      },

      // Warning colors (Coral reef/hibiscus)
      warning: {
        50: '#fff5f5',
        100: '#ffe4e6',
        200: '#fecdd3',
        500: '#f472a3',  // Hibiscus pink
        600: '#ec4899',
        700: '#db2777',
        800: '#9d174d',
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

      // Success colors (Nebula cyan/teal - distant star glow)
      success: {
        50: '#0a1a2e',
        100: '#0c2d4d',
        200: '#0e4470',
        500: '#22d3ee',  // Cosmic cyan
        600: '#67e8f9',
        700: '#a5f3fc',
        800: '#cffafe',
        900: '#ecfeff',
        950: '#f0fdff',
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
