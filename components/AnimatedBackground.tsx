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
  useTrainStation,
  useSereneMeadows,
  useStillPonds,
  useDesertDunes,
  useDucklingParade,
  useBunnyMeadow,
  useStargazing,
  useMountainMist,
  // New serene animations
  useLavenderFields,
  useZenSandGarden,
  useSunsetSailing,
  useRaindropWindow,
  // Replacement animations
  useButterflyGarden,
  useDandelionWishes,
  useMistyValley,
  useGentleWaves,
  // Additional serene animations
  useJellyfishDrift,
  useWindChimes,
  useSakuraRedux,
  useSatsSymbol,
  useFireworks,
  // New animations
  useHashStorm,
  useIceCrystals,
  useAutumnWind,
  // Abstract animations
  useSmokeCalligraphy,
  useBreath,
  useMyceliumNetwork,
  useOilSlick,
  // New landscape/nature animations
  useBioluminescentBeach,
  useVolcanicIslands,
  useTidalPatterns,
  useEclipse,
  usePaperBoats,
  usePaperAirplanes,
  useThunderstorm,
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
  // Night sky
  'stargazing',
  // New serene animations
  'lavender-fields',
  'zen-sand-garden',
  'sunset-sailing',
  'raindrop-window',
  // Replacement animations (replacing static patterns)
  'butterfly-garden',
  'dandelion-wishes',
  'misty-valley',
  'gentle-waves',
  // Additional serene animations
  'jellyfish-drift',
  'wind-chimes',
  'sakura-redux',
  'sats-symbol',
  'fireworks',
  // New animations
  'hash-storm',
  'ice-crystals',
  'autumn-wind',
  // Abstract animations
  'smoke-calligraphy',
  'breath',
  'mycelium-network',
  'oil-slick',
  // New landscape/nature animations
  'bioluminescent-beach',
  'volcanic-islands',
  'tidal-patterns',
  'eclipse',
  'paper-boats',
  'paper-airplanes',
  'thunderstorm',
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
  // Night sky
  useStargazing(canvasRef, darkMode, opacity, pattern === 'stargazing');
  // New serene animations
  useLavenderFields(canvasRef, darkMode, opacity, pattern === 'lavender-fields');
  useZenSandGarden(canvasRef, darkMode, opacity, pattern === 'zen-sand-garden');
  useSunsetSailing(canvasRef, darkMode, opacity, pattern === 'sunset-sailing');
  useRaindropWindow(canvasRef, darkMode, opacity, pattern === 'raindrop-window');
  // Replacement animations
  useButterflyGarden(canvasRef, darkMode, opacity, pattern === 'butterfly-garden');
  useDandelionWishes(canvasRef, darkMode, opacity, pattern === 'dandelion-wishes');
  useMistyValley(canvasRef, darkMode, opacity, pattern === 'misty-valley');
  useGentleWaves(canvasRef, darkMode, opacity, pattern === 'gentle-waves');
  // Additional serene animations
  useJellyfishDrift(canvasRef, darkMode, opacity, pattern === 'jellyfish-drift');
  useWindChimes(canvasRef, darkMode, opacity, pattern === 'wind-chimes');
  useSakuraRedux(canvasRef, darkMode, opacity, pattern === 'sakura-redux');
  useSatsSymbol(canvasRef, darkMode, opacity, pattern === 'sats-symbol');
  useFireworks(canvasRef, darkMode, opacity, pattern === 'fireworks');
  // New animations
  useHashStorm(canvasRef, darkMode, opacity, pattern === 'hash-storm');
  useIceCrystals(canvasRef, darkMode, opacity, pattern === 'ice-crystals');
  useAutumnWind(canvasRef, darkMode, opacity, pattern === 'autumn-wind');
  // Abstract animations
  useSmokeCalligraphy(canvasRef, darkMode, opacity, pattern === 'smoke-calligraphy');
  useBreath(canvasRef, darkMode, opacity, pattern === 'breath');
  useMyceliumNetwork(canvasRef, darkMode, opacity, pattern === 'mycelium-network');
  useOilSlick(canvasRef, darkMode, opacity, pattern === 'oil-slick');
  // New landscape/nature animations
  useBioluminescentBeach(canvasRef, darkMode, opacity, pattern === 'bioluminescent-beach');
  useVolcanicIslands(canvasRef, darkMode, opacity, pattern === 'volcanic-islands');
  useTidalPatterns(canvasRef, darkMode, opacity, pattern === 'tidal-patterns');
  useEclipse(canvasRef, darkMode, opacity, pattern === 'eclipse');
  usePaperBoats(canvasRef, darkMode, opacity, pattern === 'paper-boats');
  usePaperAirplanes(canvasRef, darkMode, opacity, pattern === 'paper-airplanes');
  useThunderstorm(canvasRef, darkMode, opacity, pattern === 'thunderstorm');

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
