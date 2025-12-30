/**
 * Animated Background Component
 *
 * Renders canvas-based animated backgrounds for special patterns.
 * Supports multiple animation types for different visual effects.
 */

import React, { useRef } from 'react';

// Import all animation hooks
import {
  useSakuraPetals,
  useFloatingShields,
  useBitcoinParticles,
  useStackingBlocks,
  useDigitalRain,
  useConstellation,
  useSanctuaryLogo,
  useSnowfall,
  useFireflies,
  useInkDrops,
  useRipplingWater,
  useFallingLeaves,
  useEmbersRising,
  useGentleRain,
  useNorthernLights,
  useKoiShadows,
  useBambooSway,
  useLotusBloom,
  useFloatingLanterns,
  useMoonlitClouds,
  useTidePools,
  useMorningDew,
  usePaperCranes,
  useTrainStation,
  useSereneMeadows,
  useStillPonds,
  useDesertDunes,
  useDucklingParade,
  useBunnyMeadow,
  useCoralReef,
  useStargazing,
  useMountainMist,
  // New serene animations
  useLavenderFields,
  useWisteriaArbor,
  useZenSandGarden,
  useCrystalCavern,
  useSunsetSailing,
  useSleepingKittens,
  useBabyDragon,
  useRaindropWindow,
  // Replacement animations
  useButterflyGarden,
  useDandelionWishes,
  useCloverField,
  useMistyValley,
  useGentleWaves,
  useAuroraWaves,
  // Additional serene animations
  useJellyfishDrift,
  useWindChimes,
} from './animations';

interface AnimatedBackgroundProps {
  pattern: string;
  darkMode: boolean;
  opacity?: number; // 0-100, default 50
}

// List of all animated pattern IDs
export const ANIMATED_PATTERNS = [
  'sakura-petals',
  'floating-shields',
  'bitcoin-particles',
  'stacking-blocks',
  'digital-rain',
  'constellation',
  'sanctuary-logo',
  'snowfall',
  'fireflies',
  'ink-drops',
  'rippling-water',
  'falling-leaves',
  'embers-rising',
  'gentle-rain',
  'northern-lights',
  // Sumi-e (ink wash) animations
  'koi-shadows',
  'bamboo-sway',
  // Zen & nature animations
  'lotus-bloom',
  'floating-lanterns',
  'moonlit-clouds',
  'tide-pools',
  'morning-dew',
  'paper-cranes',
  // Fun animations
  'train-station',
  // Landscape animations
  'serene-meadows',
  'still-ponds',
  'desert-dunes',
  'mountain-mist',
  // Cute animals
  'duckling-parade',
  'bunny-meadow',
  // Underwater
  'coral-reef',
  // Night sky
  'stargazing',
  // New serene animations
  'lavender-fields',
  'wisteria-arbor',
  'zen-sand-garden',
  'crystal-cavern',
  'sunset-sailing',
  'sleeping-kittens',
  'baby-dragon',
  'raindrop-window',
  // Replacement animations (replacing static patterns)
  'butterfly-garden',
  'dandelion-wishes',
  'clover-field',
  'misty-valley',
  'gentle-waves',
  'aurora-waves',
  // Additional serene animations
  'jellyfish-drift',
  'wind-chimes',
] as const;

export type AnimatedPatternId = typeof ANIMATED_PATTERNS[number];

export function isAnimatedPattern(pattern: string): pattern is AnimatedPatternId {
  return ANIMATED_PATTERNS.includes(pattern as AnimatedPatternId);
}

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({
  pattern,
  darkMode,
  opacity = 50,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isAnimated = isAnimatedPattern(pattern);

  // Call all hooks but only activate the one that matches the pattern
  useSakuraPetals(canvasRef, darkMode, opacity, pattern === 'sakura-petals');
  useFloatingShields(canvasRef, darkMode, opacity, pattern === 'floating-shields');
  useBitcoinParticles(canvasRef, darkMode, opacity, pattern === 'bitcoin-particles');
  useStackingBlocks(canvasRef, darkMode, opacity, pattern === 'stacking-blocks');
  useDigitalRain(canvasRef, darkMode, opacity, pattern === 'digital-rain');
  useConstellation(canvasRef, darkMode, opacity, pattern === 'constellation');
  useSnowfall(canvasRef, darkMode, opacity, pattern === 'snowfall');
  useSanctuaryLogo(canvasRef, darkMode, opacity, pattern === 'sanctuary-logo');
  useFireflies(canvasRef, darkMode, opacity, pattern === 'fireflies');
  useInkDrops(canvasRef, darkMode, opacity, pattern === 'ink-drops');
  useRipplingWater(canvasRef, darkMode, opacity, pattern === 'rippling-water');
  useFallingLeaves(canvasRef, darkMode, opacity, pattern === 'falling-leaves');
  useEmbersRising(canvasRef, darkMode, opacity, pattern === 'embers-rising');
  useGentleRain(canvasRef, darkMode, opacity, pattern === 'gentle-rain');
  useNorthernLights(canvasRef, darkMode, opacity, pattern === 'northern-lights');
  // Sumi-e animations
  useKoiShadows(canvasRef, darkMode, opacity, pattern === 'koi-shadows');
  useBambooSway(canvasRef, darkMode, opacity, pattern === 'bamboo-sway');
  // Zen & nature animations
  useLotusBloom(canvasRef, darkMode, opacity, pattern === 'lotus-bloom');
  useFloatingLanterns(canvasRef, darkMode, opacity, pattern === 'floating-lanterns');
  useMoonlitClouds(canvasRef, darkMode, opacity, pattern === 'moonlit-clouds');
  useTidePools(canvasRef, darkMode, opacity, pattern === 'tide-pools');
  useMorningDew(canvasRef, darkMode, opacity, pattern === 'morning-dew');
  usePaperCranes(canvasRef, darkMode, opacity, pattern === 'paper-cranes');
  // Fun animations
  useTrainStation(canvasRef, darkMode, opacity, pattern === 'train-station');
  // Landscape animations
  useSereneMeadows(canvasRef, darkMode, opacity, pattern === 'serene-meadows');
  useStillPonds(canvasRef, darkMode, opacity, pattern === 'still-ponds');
  useDesertDunes(canvasRef, darkMode, opacity, pattern === 'desert-dunes');
  useMountainMist(canvasRef, darkMode, opacity, pattern === 'mountain-mist');
  // Cute animals
  useDucklingParade(canvasRef, darkMode, opacity, pattern === 'duckling-parade');
  useBunnyMeadow(canvasRef, darkMode, opacity, pattern === 'bunny-meadow');
  // Underwater
  useCoralReef(canvasRef, darkMode, opacity, pattern === 'coral-reef');
  // Night sky
  useStargazing(canvasRef, darkMode, opacity, pattern === 'stargazing');
  // New serene animations
  useLavenderFields(canvasRef, darkMode, opacity, pattern === 'lavender-fields');
  useWisteriaArbor(canvasRef, darkMode, opacity, pattern === 'wisteria-arbor');
  useZenSandGarden(canvasRef, darkMode, opacity, pattern === 'zen-sand-garden');
  useCrystalCavern(canvasRef, darkMode, opacity, pattern === 'crystal-cavern');
  useSunsetSailing(canvasRef, darkMode, opacity, pattern === 'sunset-sailing');
  useSleepingKittens(canvasRef, darkMode, opacity, pattern === 'sleeping-kittens');
  useBabyDragon(canvasRef, darkMode, opacity, pattern === 'baby-dragon');
  useRaindropWindow(canvasRef, darkMode, opacity, pattern === 'raindrop-window');
  // Replacement animations
  useButterflyGarden(canvasRef, darkMode, opacity, pattern === 'butterfly-garden');
  useDandelionWishes(canvasRef, darkMode, opacity, pattern === 'dandelion-wishes');
  useCloverField(canvasRef, darkMode, opacity, pattern === 'clover-field');
  useMistyValley(canvasRef, darkMode, opacity, pattern === 'misty-valley');
  useGentleWaves(canvasRef, darkMode, opacity, pattern === 'gentle-waves');
  useAuroraWaves(canvasRef, darkMode, opacity, pattern === 'aurora-waves');
  // Additional serene animations
  useJellyfishDrift(canvasRef, darkMode, opacity, pattern === 'jellyfish-drift');
  useWindChimes(canvasRef, darkMode, opacity, pattern === 'wind-chimes');

  if (!isAnimated) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: -1,
        opacity: opacity / 100,
      }}
      aria-hidden="true"
    />
  );
};

export default AnimatedBackground;
