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
  // ============================================================================
  // ANIMATED PATTERNS (Canvas-based)
  // ============================================================================
  {
    id: 'sakura-petals',
    name: 'Sakura Petals',
    description: 'Animated falling cherry blossom petals',
    animated: true,
  },
  {
    id: 'floating-shields',
    name: 'Floating Shields',
    description: 'Gentle floating protection shields',
    animated: true,
  },
  {
    id: 'bitcoin-particles',
    name: 'Bitcoin Particles',
    description: 'Rising Bitcoin symbols with glow effect',
    animated: true,
  },
  {
    id: 'stacking-blocks',
    name: 'Stacking Blocks',
    description: 'Bitcoin blocks gently falling and stacking',
    animated: true,
  },
  {
    id: 'digital-rain',
    name: 'Digital Rain',
    description: 'Matrix-style falling characters with Bitcoin theme',
    animated: true,
  },
  {
    id: 'constellation',
    name: 'Constellation',
    description: 'Connected nodes representing the Bitcoin network',
    animated: true,
  },
  {
    id: 'sanctuary-logo',
    name: 'Sanctuary Logo',
    description: 'Scattered floating Sanctuary logos across the screen',
    animated: true,
  },
  {
    id: 'snowfall',
    name: 'Snowfall',
    description: 'Gentle falling snowflakes with crystal patterns',
    animated: true,
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    description: 'Softly glowing fireflies drifting in the night',
    animated: true,
  },
  {
    id: 'ink-drops',
    name: 'Ink Drops',
    description: 'Abstract ink slowly diffusing in water',
    animated: true,
  },
  {
    id: 'rippling-water',
    name: 'Rippling Water',
    description: 'Gentle ripples appearing on calm water',
    animated: true,
  },
  {
    id: 'falling-leaves',
    name: 'Falling Leaves',
    description: 'Autumn leaves drifting and swaying as they fall',
    animated: true,
  },
  {
    id: 'embers-rising',
    name: 'Embers Rising',
    description: 'Warm embers floating upward like campfire sparks',
    animated: true,
  },
  {
    id: 'gentle-rain',
    name: 'Gentle Rain',
    description: 'Soft diagonal rain streaks with subtle splash effects',
    animated: true,
  },
  {
    id: 'northern-lights',
    name: 'Northern Lights',
    description: 'Flowing aurora bands with shifting colors',
    animated: true,
  },
];
