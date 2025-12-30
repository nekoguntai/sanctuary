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
    id: 'butterfly-garden',
    name: 'Butterfly Garden',
    description: 'Colorful butterflies fluttering among flowers',
    animated: true,
  },
  {
    id: 'stars',
    name: 'Stars',
    description: 'Scattered starfield pattern',
    // Defined in index.html CSS
  },
  {
    id: 'dandelion-wishes',
    name: 'Dandelion Wishes',
    description: 'Fluffy dandelion seeds floating on the breeze',
    animated: true,
  },
  {
    id: 'misty-valley',
    name: 'Misty Valley',
    description: 'Layered mountains with drifting mist and soft light',
    animated: true,
  },
  {
    id: 'gentle-waves',
    name: 'Gentle Waves',
    description: 'Soft flowing ocean waves with sparkles',
    animated: true,
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
  // Sumi-e (ink wash) animations
  {
    id: 'koi-shadows',
    name: 'Koi Shadows',
    description: 'Graceful koi fish rendered as ink brush strokes',
    animated: true,
  },
  {
    id: 'bamboo-sway',
    name: 'Bamboo Sway',
    description: 'Bamboo stalks gently swaying in the breeze',
    animated: true,
  },
  // Zen & nature animations
  {
    id: 'lotus-bloom',
    name: 'Lotus Bloom',
    description: 'Soft lotus flowers slowly opening and closing',
    animated: true,
  },
  {
    id: 'floating-lanterns',
    name: 'Floating Lanterns',
    description: 'Paper lanterns gently rising like sky lanterns',
    animated: true,
  },
  {
    id: 'moonlit-clouds',
    name: 'Moonlit Clouds',
    description: 'Soft clouds drifting with subtle moonlight glow',
    animated: true,
  },
  {
    id: 'tide-pools',
    name: 'Tide Pools',
    description: 'Gentle water ripples with subtle reflections',
    animated: true,
  },
  // Fun animations
  {
    id: 'train-station',
    name: 'Train Station',
    description: 'Japanese trains arriving and departing with passengers',
    animated: true,
  },
  // Landscape animations
  {
    id: 'serene-meadows',
    name: 'Serene Meadows',
    description: 'Peaceful rolling hills with trees, flowers, and drifting mist',
    animated: true,
  },
  {
    id: 'still-ponds',
    name: 'Still Ponds',
    description: 'Serene pond with lily pads, koi fish, and dragonflies',
    animated: true,
  },
  {
    id: 'desert-dunes',
    name: 'Desert Dunes',
    description: 'Rolling sand dunes with cacti and warm desert atmosphere',
    animated: true,
  },
  {
    id: 'mountain-mist',
    name: 'Mountain Mist',
    description: 'Layered mountains with drifting mist and pine trees',
    animated: true,
  },
  {
    id: 'duckling-parade',
    name: 'Duckling Parade',
    description: 'Adorable mother duck with ducklings following in a line',
    animated: true,
  },
  {
    id: 'bunny-meadow',
    name: 'Bunny Meadow',
    description: 'Fluffy bunnies hopping around a flower meadow',
    animated: true,
  },
  {
    id: 'stargazing',
    name: 'Stargazing',
    description: 'Peaceful night sky with twinkling stars and shooting stars',
    animated: true,
  },
  // New serene animations
  {
    id: 'lavender-fields',
    name: 'Lavender Fields',
    description: 'Rolling lavender fields swaying in the breeze with butterflies',
    animated: true,
  },
  {
    id: 'zen-sand-garden',
    name: 'Zen Sand Garden',
    description: 'Peaceful raked sand patterns with moss-covered stones',
    animated: true,
  },
  {
    id: 'sunset-sailing',
    name: 'Sunset Sailing',
    description: 'Sailboats gliding peacefully on calm water at sunset',
    animated: true,
  },
  {
    id: 'raindrop-window',
    name: 'Raindrop Window',
    description: 'Raindrops rolling down a window with bokeh lights',
    animated: true,
  },
  // Additional serene animations
  {
    id: 'wind-chimes',
    name: 'Wind Chimes',
    description: 'Delicate hanging wind chimes with gentle swaying motion',
    animated: true,
  },
  {
    id: 'jellyfish-drift',
    name: 'Jellyfish Drift',
    description: 'Graceful bioluminescent jellyfish floating through deep ocean',
    animated: true,
  },
  {
    id: 'sakura-redux',
    name: 'Sakura Redux',
    description: 'Cherry blossom petals that collect at the bottom over 10 minutes',
    animated: true,
  },
  {
    id: 'sats-symbol',
    name: 'Sats Symbol',
    description: 'Floating sats symbols with subtle glow and particle effects',
    animated: true,
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    description: 'Colorful fireworks bursting in the night sky',
    animated: true,
  },
  // Bitcoin themed
  {
    id: 'hash-storm',
    name: 'Hash Storm',
    description: 'Cryptographic characters swirling like a data tornado',
    animated: true,
  },
  // Winter themed
  {
    id: 'ice-crystals',
    name: 'Ice Crystals',
    description: 'Frost patterns forming and dissolving',
    animated: true,
  },
  // Fall themed
  {
    id: 'autumn-wind',
    name: 'Autumn Wind',
    description: 'Swirling gusts carrying fallen leaves',
    animated: true,
  },
  // Abstract animations
  {
    id: 'smoke-calligraphy',
    name: 'Smoke Calligraphy',
    description: 'Delicate incense smoke wisps curling and dissipating',
    animated: true,
  },
  {
    id: 'breath',
    name: 'Breath',
    description: 'Gentle pulsing shapes that expand and contract like breathing',
    animated: true,
  },
  {
    id: 'mycelium-network',
    name: 'Mycelium Network',
    description: 'Organic branching lines growing and pulsing with energy',
    animated: true,
  },
  {
    id: 'oil-slick',
    name: 'Oil Slick',
    description: 'Iridescent swirling patterns with rainbow interference colors',
    animated: true,
  },
  // New landscape/nature animations
  {
    id: 'bioluminescent-beach',
    name: 'Bioluminescent Beach',
    description: 'Waves lapping shore with glowing blue bioluminescence under starry sky',
    animated: true,
  },
  {
    id: 'volcanic-islands',
    name: 'Volcanic Islands',
    description: 'Distant volcanic glow with palm silhouettes and rising lava particles',
    animated: true,
  },
  {
    id: 'tidal-patterns',
    name: 'Tidal Patterns',
    description: 'Sand ripples with water flowing over them and scattered shells',
    animated: true,
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    description: 'Slow-moving solar eclipse with corona effects and appearing stars',
    animated: true,
  },
  {
    id: 'paper-boats',
    name: 'Paper Boats',
    description: 'Tiny paper boats floating on a gentle stream with fallen petals',
    animated: true,
  },
  {
    id: 'paper-airplanes',
    name: 'Paper Airplanes',
    description: 'Delicate paper airplanes gliding through a soft sky with gentle loops',
    animated: true,
  },
  {
    id: 'thunderstorm',
    name: 'Thunderstorm',
    description: 'Dark rolling clouds with dramatic lightning flashes and heavy rain',
    animated: true,
  },
];
