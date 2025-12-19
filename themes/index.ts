/**
 * Theme System
 *
 * Central export point for the extensible theme system.
 * Import from this file to access themes, patterns, and utilities.
 *
 * To add a new theme:
 * 1. Create a new folder in /themes with your theme name
 * 2. Create an index.ts file that exports a ThemeDefinition
 * 3. Import and register it in this file
 */

import { themeRegistry } from './registry';
import { globalPatterns } from './patterns';
import { createLogger } from '../utils/logger';

const log = createLogger('Themes');

// Import all themes
import { sanctuaryTheme } from './sanctuary';
import { serenityTheme } from './serenity';
import { forestTheme } from './forest';
import { cyberTheme } from './cyber';
import { sunriseTheme } from './sunrise';
import { oceanTheme } from './ocean';
import { nordicTheme } from './sunset';
import { midnightTheme } from './midnight';

// Register all themes
themeRegistry.registerMany([
  sanctuaryTheme,
  serenityTheme,
  forestTheme,
  cyberTheme,
  sunriseTheme,
  oceanTheme,
  nordicTheme,
  midnightTheme,
]);

// Register global patterns
themeRegistry.registerPatterns(globalPatterns);

// Re-export for convenience
export { themeRegistry };
export { globalPatterns };
export type { ThemeDefinition, ThemeColors, BackgroundPattern, ThemeMetadata } from './types';

/**
 * Initialize the theme system
 * Call this on app startup to ensure themes are available
 */
export function initializeThemes(): void {
  // Themes are automatically registered on import
  log.info(`Theme system initialized with ${themeRegistry.getAll().length} themes`);
}

/**
 * Get all available theme IDs
 */
export function getThemeIds(): string[] {
  return themeRegistry.getAll().map(t => t.id);
}

/**
 * Get all available pattern IDs
 */
export function getPatternIds(themeId?: string): string[] {
  return themeRegistry.getAllPatterns(themeId).map(p => p.id);
}
