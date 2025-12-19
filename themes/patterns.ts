/**
 * Global Background Patterns
 *
 * These patterns can be used with any theme. Each pattern is defined as
 * an SVG data URL for optimal performance.
 */

import type { BackgroundPattern } from './types';

export const globalPatterns: BackgroundPattern[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean, no pattern background',
    // No SVG needed - just solid background
  },
  {
    id: 'zen',
    name: 'Zen Dots',
    description: 'Subtle dot grid pattern',
    // These patterns are defined in index.html CSS - don't override them
    // Let the CSS handle it for proper light/dark mode handling
  },
  {
    id: 'circuit',
    name: 'Circuit',
    description: 'Tech-inspired geometric nodes',
    // Defined in index.html CSS
  },
  {
    id: 'topography',
    name: 'Topography',
    description: 'Topographic map lines',
    // Defined in index.html CSS
  },
  {
    id: 'waves',
    name: 'Waves',
    description: 'Flowing water pattern',
    // Defined in index.html CSS
  },
  {
    id: 'lines',
    name: 'Diagonal Lines',
    description: 'Subtle diagonal stripes',
    // Defined in index.html CSS
  },
  {
    id: 'sanctuary',
    name: 'Sanctuary Logo (Tiled)',
    description: 'Small repeating Sanctuary logo',
    // Defined in index.html CSS
  },
  {
    id: 'sanctuary-hero',
    name: 'Sanctuary Hero',
    description: 'Large centered Sanctuary logo',
    // This pattern uses CSS from index.html for fixed background positioning
    // We set empty SVGs here so the registry doesn't override the CSS
  },
  {
    id: 'hexagons',
    name: 'Hexagons',
    description: 'Honeycomb hexagonal grid',
    // Defined in index.html CSS
  },
  {
    id: 'triangles',
    name: 'Triangles',
    description: 'Geometric triangle tessellation',
    // Defined in index.html CSS
  },
  {
    id: 'stars',
    name: 'Stars',
    description: 'Scattered starfield pattern',
    // Defined in index.html CSS
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Flowing aurora gradient mesh',
    // Defined in index.html CSS
  },
  {
    id: 'dots',
    name: 'Polka Dots',
    description: 'Regular dot grid pattern',
    // Defined in index.html CSS
  },
  {
    id: 'cross',
    name: 'Crosshatch',
    description: 'Subtle cross-stitch texture',
    // Defined in index.html CSS
  },
  {
    id: 'mountains',
    name: 'Mountains',
    description: 'Layered mountain silhouettes',
    // Defined in index.html CSS
  },
  {
    id: 'noise',
    name: 'Noise',
    description: 'Subtle grainy texture',
    // Defined in index.html CSS
  },
];
