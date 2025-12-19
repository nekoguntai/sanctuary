/**
 * Nordic Theme
 *
 * Minimalist Scandinavian-inspired theme with cool grays and icy blues.
 * Clean, professional aesthetic with excellent readability and subtle
 * elegance. Perfect for focused work and a calm environment.
 *
 * Light mode: Crisp white backgrounds with cool gray accents and ice blue touches
 * Dark mode: Deep charcoal backgrounds with steel blue highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const nordicTheme: ThemeDefinition = {
  id: 'nordic',
  name: 'Nordic',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Minimalist cool grays and icy blues inspired by Scandinavian design',

  colors: {
    light: {
      // Background colors (Cool gray/white - crisp and clean)
      bg: {
        50: '#ffffff',   // Pure white
        100: '#f8f9fa',  // Lightest gray
        200: '#e9ecef',  // Light gray
        300: '#dee2e6',  // Soft gray
        400: '#ced4da',  // Medium light gray
        500: '#adb5bd',  // Mid gray
        600: '#868e96',  // Steel gray
        700: '#495057',  // Dark gray
        800: '#343a40',  // Charcoal
        900: '#212529',  // Near black
        950: '#0d1117',  // Darkest
      },

      // Primary colors (Ice blue - cool and calming)
      primary: {
        50: '#f0f9ff',   // Palest sky
        100: '#e0f2fe',  // Light ice
        200: '#bae6fd',  // Soft blue
        300: '#7dd3fc',  // Light sky blue
        400: '#38bdf8',  // Bright sky
        500: '#0ea5e9',  // Sky blue (main)
        600: '#0284c7',  // Deep sky
        700: '#0369a1',  // Steel blue
        800: '#075985',  // Dark steel
        900: '#0c4a6e',  // Navy blue
        950: '#082f49',  // Darkest blue
      },

      // Success colors (Cool mint green)
      success: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        500: '#22c55e',  // Green-500: Clean success
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
        900: '#14532d',
        950: '#052e16',
      },

      // Warning colors (Cool amber)
      warning: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        500: '#eab308',  // Yellow-500: Neutral warning
        600: '#ca8a04',
        700: '#a16207',
        800: '#854d0e',
        900: '#713f12',
        950: '#422006',
      },
    },

    dark: {
      // Background colors (Deep charcoal/slate - Nordic night)
      bg: {
        50: '#f8fafc',   // Light for text
        100: '#f1f5f9',
        200: '#e2e8f0',
        300: '#cbd5e1',
        400: '#94a3b8',  // Slate gray
        500: '#64748b',  // Mid slate
        600: '#475569',  // Steel slate
        700: '#334155',  // Dark slate
        800: '#1e293b',  // Deep charcoal panels
        900: '#0f172a',  // Main background
        950: '#020617',  // Darkest charcoal-black
      },

      // Primary colors (Bright ice blue for dark mode)
      primary: {
        50: '#082f49',   // Dark sky (inverted)
        100: '#0c4a6e',
        200: '#075985',
        300: '#0369a1',
        400: '#0284c7',
        500: '#0ea5e9',  // Sky-500: Ice blue accent
        600: '#38bdf8',
        700: '#7dd3fc',
        800: '#bae6fd',
        900: '#e0f2fe',
        950: '#f0f9ff',
      },

      // Success colors (Bright mint)
      success: {
        50: '#052e16',
        100: '#14532d',
        200: '#166534',
        500: '#4ade80',  // Brighter green for dark mode
        600: '#86efac',
        700: '#bbf7d0',
        800: '#dcfce7',
        900: '#f0fdf4',
        950: '#f0fdf9',
      },

      // Warning colors (Warm amber for contrast)
      warning: {
        50: '#422006',
        100: '#713f12',
        200: '#854d0e',
        500: '#fbbf24',  // Amber-400: Warm warning
        600: '#fcd34d',
        700: '#fde68a',
        800: '#fef3c7',
        900: '#fffbeb',
        950: '#fffef7',
      },
    },
  },
};
