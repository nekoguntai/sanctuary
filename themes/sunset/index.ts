/**
 * Sakura Theme
 *
 * Japanese cherry blossom inspired theme with delicate pinks and natural greens.
 * Elegant, calming aesthetic inspired by spring in Japan.
 *
 * Light mode: Soft whites with delicate pink blossom accents and spring green touches
 * Dark mode: Deep plum/burgundy backgrounds with soft pink highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sakuraTheme: ThemeDefinition = {
  id: 'sakura',
  name: 'Sakura',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Delicate cherry blossom pinks with elegant Japanese aesthetics',

  colors: {
    light: {
      // Background colors (Soft white with warm undertones - rice paper)
      bg: {
        50: '#fffcfd',   // Pure white with pink hint
        100: '#fef7f8',  // Soft blush white
        200: '#fceef0',  // Pale pink-white
        300: '#f8dfe3',  // Light blush
        400: '#e8c4ca',  // Dusty rose
        500: '#b8949a',  // Muted mauve
        600: '#8a6b72',  // Deep rose
        700: '#5c464c',  // Dark plum
        800: '#3a2c30',  // Deep burgundy
        900: '#231b1d',  // Near black
        950: '#120e0f',  // Darkest
      },

      // Primary colors (Cherry blossom pink)
      primary: {
        50: '#fff1f3',   // Palest pink
        100: '#ffe4e8',  // Light petal
        200: '#fecdd5',  // Soft blossom
        300: '#fda4b4',  // Pink petal
        400: '#fb7190',  // Bright sakura
        500: '#f43f6b',  // Vibrant cherry blossom
        600: '#e11d52',  // Deep pink
        700: '#be1244',  // Dark rose
        800: '#9f1340',  // Burgundy pink
        900: '#88143c',  // Deep burgundy
        950: '#4c0519',  // Darkest
      },

      // Success colors (Spring leaf green)
      success: {
        50: '#f3faf3',
        100: '#e3f5e3',
        200: '#c8eac9',
        500: '#5cb85c',  // Fresh leaf green
        600: '#4a9a4a',
        700: '#3d7d3d',
        800: '#346434',
        900: '#2d522d',
        950: '#142d14',
      },

      // Warning colors (Persimmon orange - Japanese fruit)
      warning: {
        50: '#fff8ed',
        100: '#ffeed4',
        200: '#ffd9a8',
        500: '#f5a524',  // Persimmon orange
        600: '#e08914',
        700: '#ba6a10',
        800: '#955314',
        900: '#794515',
        950: '#412108',
      },

      // Sent colors (Wisteria purple)
      sent: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        500: '#a855f7',  // Wisteria
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
      },

      // Mainnet colors (Sakura pink)
      mainnet: {
        50: '#fff1f3',
        100: '#ffe4e8',
        200: '#fecdd5',
        300: '#fda4b4',
        400: '#fb7190',
        500: '#f43f6b',  // Cherry blossom
        600: '#e11d52',
        700: '#be1244',
        800: '#9f1340',
        900: '#88143c',
        950: '#4c0519',
      },

      // Testnet colors (Bamboo green)
      testnet: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        300: '#86efac',
        400: '#4ade80',
        500: '#22c55e',  // Bamboo green
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
        900: '#14532d',
        950: '#052e16',
      },

      // Signet colors (Wisteria purple)
      signet: {
        50: '#f5f3ff',
        100: '#ede9fe',
        200: '#ddd6fe',
        300: '#c4b5fd',
        400: '#a78bfa',
        500: '#8b5cf6',  // Wisteria
        600: '#7c3aed',
        700: '#6d28d9',
        800: '#5b21b6',
        900: '#4c1d95',
        950: '#2e1065',
      },
    },

    dark: {
      // Background colors (Deep plum/burgundy - evening sakura viewing)
      bg: {
        50: '#fce8eb',   // Pale pink (for text)
        100: '#f5d0d6',  // Light blush
        200: '#e8a8b2',  // Soft rose
        300: '#d47a8a',  // Muted pink
        400: '#a85060',  // Dusty rose
        500: '#7a3a48',  // Deep mauve
        600: '#542832',  // Dark plum
        700: '#3a1c24',  // Deep burgundy
        800: '#281418',  // Night plum
        900: '#1a0d10',  // Near black
        950: '#0d0608',  // Deepest shadow
      },

      // Primary colors (Glowing cherry blossom for dark mode)
      primary: {
        50: '#4c0519',   // Deep shadow
        100: '#88143c',  // Dark burgundy
        200: '#9f1340',  // Burgundy pink
        300: '#be1244',  // Dark rose
        400: '#e11d52',  // Deep pink
        500: '#f43f6b',  // Vibrant sakura
        600: '#fb7190',  // Bright petal
        700: '#fda4b4',  // Soft glow
        800: '#fecdd5',  // Light glow
        900: '#ffe4e8',  // Pale glow
        950: '#fff1f3',  // Brightest
      },

      // Success colors (Bright spring green for dark mode)
      success: {
        50: '#142d14',
        100: '#2d522d',
        200: '#346434',
        500: '#68d878',  // Glowing leaf
        600: '#8ae496',
        700: '#adefb4',
        800: '#cff7d4',
        900: '#e8fcea',
        950: '#f4fef5',
      },

      // Warning colors (Lantern glow - warm amber)
      warning: {
        50: '#412108',
        100: '#794515',
        200: '#955314',
        500: '#fbbf24',  // Paper lantern glow
        600: '#fcd34d',
        700: '#fde68a',
        800: '#fef3c7',
        900: '#fffbeb',
        950: '#fffef7',
      },

      // Sent colors (Wisteria - inverted)
      sent: {
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

      // Mainnet colors (Sakura pink - inverted for dark)
      mainnet: {
        50: '#4c0519',
        100: '#88143c',
        200: '#9f1340',
        300: '#be1244',
        400: '#e11d52',
        500: '#f43f6b',  // Cherry blossom
        600: '#fb7190',
        700: '#fda4b4',
        800: '#fecdd5',
        900: '#ffe4e8',
        950: '#fff1f3',
      },

      // Testnet colors (Bamboo green - inverted)
      testnet: {
        50: '#052e16',
        100: '#14532d',
        200: '#166534',
        300: '#15803d',
        400: '#16a34a',
        500: '#4ade80',  // Glowing bamboo
        600: '#86efac',
        700: '#bbf7d0',
        800: '#dcfce7',
        900: '#f0fdf4',
        950: '#f7fef9',
      },

      // Signet colors (Wisteria - inverted)
      signet: {
        50: '#2e1065',
        100: '#4c1d95',
        200: '#5b21b6',
        300: '#6d28d9',
        400: '#7c3aed',
        500: '#a78bfa',  // Glowing wisteria
        600: '#c4b5fd',
        700: '#ddd6fe',
        800: '#ede9fe',
        900: '#f5f3ff',
        950: '#faf8ff',
      },
    },
  },
};
