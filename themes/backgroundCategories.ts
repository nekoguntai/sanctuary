/**
 * Background Categories
 *
 * Organizes backgrounds into intuitive categories for easier navigation.
 * A background can belong to multiple categories (tags).
 */

import { BackgroundOption } from '../types';

export type BackgroundCategory =
  | 'all'
  | 'favorites'
  | 'minimal'
  | 'geometric'
  | 'bitcoin'
  | 'nature'
  | 'weather'
  | 'water'
  | 'zen'
  | 'sky'
  | 'creatures'
  | 'landscape'
  | 'whimsical';

export interface CategoryInfo {
  id: BackgroundCategory;
  label: string;
  icon: string; // Emoji for category display
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'all', label: 'All', icon: '◉' },
  { id: 'favorites', label: 'Favorites', icon: '★' },
  { id: 'minimal', label: 'Minimal', icon: '○' },
  { id: 'geometric', label: 'Geometric', icon: '◇' },
  { id: 'bitcoin', label: 'Bitcoin', icon: '₿' },
  { id: 'nature', label: 'Nature', icon: '🌿' },
  { id: 'weather', label: 'Weather', icon: '☁' },
  { id: 'water', label: 'Water', icon: '💧' },
  { id: 'zen', label: 'Zen', icon: '☯' },
  { id: 'sky', label: 'Sky', icon: '✦' },
  { id: 'creatures', label: 'Creatures', icon: '🦋' },
  { id: 'landscape', label: 'Landscape', icon: '⛰' },
  { id: 'whimsical', label: 'Whimsical', icon: '✨' },
];

/**
 * Map of background ID to its categories.
 * Backgrounds not listed here will appear in 'all' but won't be in any specific category.
 */
export const BACKGROUND_CATEGORIES: Partial<Record<BackgroundOption, BackgroundCategory[]>> = {
  // Static - Minimal
  'minimal': ['minimal'],
  'zen': ['minimal', 'zen'],
  'dots': ['minimal', 'geometric'],
  'lines': ['minimal', 'geometric'],
  'cross': ['minimal', 'geometric'],
  'noise': ['minimal'],

  // Static - Geometric
  'circuit': ['geometric', 'bitcoin'],
  'topography': ['geometric', 'landscape'],
  'hexagons': ['geometric'],
  'triangles': ['geometric'],
  'waves': ['geometric', 'water'],

  // Static - Themed
  'sanctuary': ['bitcoin', 'minimal'],
  'sanctuary-hero': ['bitcoin'],
  'stars': ['sky', 'minimal'],
  'aurora': ['sky', 'weather'],
  'mountains': ['landscape'],

  // Animated - Bitcoin/Tech
  'sakura-petals': ['nature', 'zen', 'whimsical'],
  'floating-shields': ['bitcoin', 'whimsical'],
  'bitcoin-particles': ['bitcoin'],
  'stacking-blocks': ['bitcoin', 'geometric'],
  'digital-rain': ['bitcoin', 'geometric'],
  'constellation': ['bitcoin', 'sky', 'geometric'],
  'sanctuary-logo': ['bitcoin'],
  'sats-symbol': ['bitcoin'],
  'hash-storm': ['bitcoin', 'geometric'],

  // Animated - Weather
  'snowfall': ['weather', 'whimsical'],
  'fireflies': ['nature', 'creatures', 'whimsical'],
  'gentle-rain': ['weather', 'zen'],
  'northern-lights': ['weather', 'sky'],
  'thunderstorm': ['weather', 'sky'],
  'ice-crystals': ['weather', 'whimsical'],
  'raindrop-window': ['weather', 'zen'],

  // Animated - Nature
  'falling-leaves': ['nature', 'weather'],
  'embers-rising': ['nature', 'weather'],
  'ink-drops': ['zen', 'water'],
  'rippling-water': ['water', 'zen'],
  'butterfly-garden': ['nature', 'creatures', 'whimsical'],
  'dandelion-wishes': ['nature', 'whimsical'],
  'lavender-fields': ['nature', 'landscape'],
  'serene-meadows': ['nature', 'landscape', 'zen'],
  'autumn-wind': ['nature', 'weather'],

  // Animated - Sumi-e/Zen
  'brush-stroke-blossoms': ['zen', 'nature'],
  'ink-branch': ['zen', 'nature'],
  'calligraphy-wind': ['zen', 'whimsical'],
  'mountain-mist': ['zen', 'landscape'],
  'koi-shadows': ['zen', 'creatures', 'water'],
  'bamboo-sway': ['zen', 'nature'],
  'ink-on-water': ['zen', 'water'],
  'enso-circles': ['zen', 'geometric'],
  'zen-sand-garden': ['zen', 'minimal'],
  'smoke-calligraphy': ['zen'],
  'breath': ['zen', 'minimal'],
  'sakura-redux': ['zen', 'nature', 'whimsical'],

  // Animated - Water/Ocean
  'gentle-waves': ['water', 'zen'],
  'tide-pools': ['water', 'nature', 'creatures'],
  'bioluminescent-beach': ['water', 'creatures', 'whimsical'],
  'tidal-patterns': ['water', 'geometric'],
  'jellyfish-drift': ['water', 'creatures', 'whimsical'],

  // Animated - Sky/Celestial
  'stargazing': ['sky', 'zen'],
  'moonlit-clouds': ['sky', 'zen'],
  'eclipse': ['sky'],
  'fireworks': ['sky', 'whimsical'],

  // Animated - Landscape
  'misty-valley': ['landscape', 'zen'],
  'desert-dunes': ['landscape'],
  'volcanic-islands': ['landscape', 'weather'],
  'still-ponds': ['water', 'landscape', 'zen'],

  // Animated - Creatures
  'duckling-parade': ['creatures', 'whimsical'],
  'bunny-meadow': ['creatures', 'nature', 'whimsical'],

  // Animated - Whimsical
  'floating-lanterns': ['whimsical', 'sky'],
  'paper-boats': ['whimsical', 'water'],
  'paper-airplanes': ['whimsical', 'sky'],
  'wind-chimes': ['whimsical', 'zen'],
  'lotus-bloom': ['nature', 'water', 'zen'],
  'sunset-sailing': ['water', 'sky', 'landscape'],
  'train-station': ['landscape', 'zen'],

  // Animated - Abstract
  'mycelium-network': ['nature', 'geometric'],
  'oil-slick': ['geometric', 'whimsical'],
};

/**
 * Get all backgrounds in a specific category
 */
export function getBackgroundsByCategory(category: BackgroundCategory): BackgroundOption[] {
  return (Object.entries(BACKGROUND_CATEGORIES) as [BackgroundOption, BackgroundCategory[]][])
    .filter(([_, categories]) => categories.includes(category))
    .map(([id]) => id);
}

/**
 * Get all categories for a specific background
 */
export function getCategoriesForBackground(background: BackgroundOption): BackgroundCategory[] {
  return BACKGROUND_CATEGORIES[background] || [];
}

/**
 * Search backgrounds by name (case-insensitive)
 */
export function searchBackgrounds(
  query: string,
  backgrounds: { id: BackgroundOption; name: string }[]
): { id: BackgroundOption; name: string }[] {
  const lowerQuery = query.toLowerCase();
  return backgrounds.filter(bg =>
    bg.name.toLowerCase().includes(lowerQuery) ||
    bg.id.toLowerCase().includes(lowerQuery)
  );
}
