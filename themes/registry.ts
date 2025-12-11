/**
 * Theme Registry
 *
 * Central registry for all available themes. Themes can be registered
 * dynamically, making it easy to add new themes without modifying core code.
 */

import type { ThemeDefinition, ThemeMetadata, BackgroundPattern } from './types';

class ThemeRegistry {
  private themes: Map<string, ThemeDefinition> = new Map();
  private globalPatterns: Map<string, BackgroundPattern> = new Map();

  /**
   * Register a new theme
   */
  register(theme: ThemeDefinition): void {
    if (this.themes.has(theme.id)) {
      console.warn(`Theme "${theme.id}" is already registered. Overwriting.`);
    }
    this.themes.set(theme.id, theme);
  }

  /**
   * Register multiple themes at once
   */
  registerMany(themes: ThemeDefinition[]): void {
    themes.forEach(theme => this.register(theme));
  }

  /**
   * Get a specific theme by ID
   */
  get(id: string): ThemeDefinition | undefined {
    return this.themes.get(id);
  }

  /**
   * Get all registered themes
   */
  getAll(): ThemeDefinition[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get theme metadata for display in UI
   */
  getAllMetadata(): ThemeMetadata[] {
    return this.getAll().map(theme => ({
      id: theme.id,
      name: theme.name,
      author: theme.author,
      description: theme.description,
      preview: {
        primaryColor: theme.colors.light.primary,
        backgroundColor: theme.colors.light.background,
      },
    }));
  }

  /**
   * Check if a theme exists
   */
  has(id: string): boolean {
    return this.themes.has(id);
  }

  /**
   * Register a global background pattern
   */
  registerPattern(pattern: BackgroundPattern): void {
    this.globalPatterns.set(pattern.id, pattern);
  }

  /**
   * Register multiple background patterns
   */
  registerPatterns(patterns: BackgroundPattern[]): void {
    patterns.forEach(pattern => this.registerPattern(pattern));
  }

  /**
   * Get all available background patterns (global + theme-specific)
   */
  getAllPatterns(themeId?: string): BackgroundPattern[] {
    const patterns = Array.from(this.globalPatterns.values());

    // Add theme-specific patterns if a theme is specified
    if (themeId) {
      const theme = this.get(themeId);
      if (theme?.patterns) {
        patterns.push(...theme.patterns);
      }
    }

    return patterns;
  }

  /**
   * Get a specific pattern by ID
   */
  getPattern(id: string, themeId?: string): BackgroundPattern | undefined {
    // Check global patterns first
    const globalPattern = this.globalPatterns.get(id);
    if (globalPattern) return globalPattern;

    // Check theme-specific patterns
    if (themeId) {
      const theme = this.get(themeId);
      return theme?.patterns?.find(p => p.id === id);
    }

    return undefined;
  }

  /**
   * Apply a theme to the document
   */
  applyTheme(themeId: string, mode: 'light' | 'dark'): void {
    const theme = this.get(themeId);
    if (!theme) {
      console.error(`Theme "${themeId}" not found`);
      return;
    }

    const colors = theme.colors[mode];
    const root = document.documentElement;

    // Apply color scale variables (bg, primary, success, warning)
    Object.entries(colors).forEach(([colorType, scale]) => {
      if (typeof scale === 'object') {
        Object.entries(scale).forEach(([shade, value]) => {
          if (value) {
            root.style.setProperty(`--color-${colorType}-${shade}`, value);
          }
        });
      }
    });

    // Apply theme class to body
    document.body.className = document.body.className
      .split(' ')
      .filter(cls => !cls.startsWith('theme-'))
      .join(' ');
    document.body.classList.add(`theme-${themeId}`);
  }

  /**
   * Apply a background pattern to the document
   */
  applyPattern(patternId: string, themeId?: string): void {
    const pattern = this.getPattern(patternId, themeId);

    // Remove existing pattern classes
    document.body.className = document.body.className
      .split(' ')
      .filter(cls => !cls.startsWith('bg-pattern-'))
      .join(' ');

    // Add new pattern class
    document.body.classList.add(`bg-pattern-${patternId}`);

    // If pattern has custom SVG, inject it into a style element
    if (pattern && (pattern.svgLight || pattern.svgDark)) {
      this.injectPatternStyles(patternId, pattern);
    }
  }

  /**
   * Inject pattern SVG styles into the document
   */
  private injectPatternStyles(patternId: string, pattern: BackgroundPattern): void {
    const styleId = `pattern-${patternId}`;
    let styleEl = document.getElementById(styleId);

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const lightSvg = pattern.svgLight || pattern.svgDark || '';
    const darkSvg = pattern.svgDark || pattern.svgLight || '';

    styleEl.textContent = `
      .bg-pattern-${patternId} {
        background-image: url("${lightSvg}");
      }
      .dark .bg-pattern-${patternId} {
        background-image: url("${darkSvg}");
      }
    `;
  }

  /**
   * Remove all themes (useful for testing)
   */
  clear(): void {
    this.themes.clear();
    this.globalPatterns.clear();
  }
}

// Export singleton instance
export const themeRegistry = new ThemeRegistry();
