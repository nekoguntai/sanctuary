/**
 * Theme System Type Definitions
 *
 * This file defines the structure for the extensible theme system.
 * New themes can be added by implementing the ThemeDefinition interface.
 */

/**
 * Color scale (50-950) matching Tailwind's color system
 */
export interface ColorScale {
  50?: string;
  100?: string;
  200?: string;
  300?: string;
  400?: string;
  500?: string;
  600?: string;
  700?: string;
  800?: string;
  900?: string;
  950?: string;
}

/**
 * CSS color variables for a theme mode (light or dark)
 * Matches the Tailwind color system used in the app
 */
export interface ThemeColors {
  // Background color scale (bg-50 through bg-950)
  bg: ColorScale;

  // Primary color scale (primary-50 through primary-950)
  primary: ColorScale;

  // Success color scale (success-50 through success-950)
  success: ColorScale;

  // Warning color scale (warning-50 through warning-950)
  warning: ColorScale;

  // Sent color scale (sent-50 through sent-950) - for sent transactions
  sent?: ColorScale;

  // Mainnet color scale (mainnet-50 through mainnet-950) - for mainnet network indicator
  mainnet?: ColorScale;

  // Testnet color scale (testnet-50 through testnet-950) - for testnet network indicator
  testnet?: ColorScale;

  // Signet color scale (signet-50 through signet-950) - for signet network indicator
  signet?: ColorScale;
}

/**
 * Background pattern definition
 */
export interface BackgroundPattern {
  id: string;
  name: string;
  description?: string;
  svgLight?: string;  // SVG pattern for light mode
  svgDark?: string;   // SVG pattern for dark mode (if different)
}

/**
 * Complete theme definition
 */
export interface ThemeDefinition {
  id: string;
  name: string;
  author?: string;
  version?: string;
  description?: string;

  // Color definitions for both modes
  colors: {
    light: ThemeColors;
    dark: ThemeColors;
  };

  // Optional background patterns specific to this theme
  patterns?: BackgroundPattern[];
}

/**
 * Theme metadata for display purposes
 */
export interface ThemeMetadata {
  id: string;
  name: string;
  author?: string;
  description?: string;
  preview?: {
    primaryColor: string;
    backgroundColor: string;
  };
}
