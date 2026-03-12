/**
 * Animated Background Component
 *
 * Renders canvas-based animated backgrounds for special patterns.
 * Supports multiple animation types for different visual effects.
 */

import React, { useRef } from 'react';
import {
  ANIMATED_PATTERNS,
  isAnimatedPattern,
  type AnimatedPatternId,
} from './animatedPatterns';

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

export { ANIMATED_PATTERNS, isAnimatedPattern };
export type { AnimatedPatternId };

interface AnimatedBackgroundProps {
  pattern: string;
  darkMode: boolean;
  opacity?: number; // 0-100, default 50
}

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({
  pattern,
  darkMode,
  opacity = 50,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationCanvasRef = canvasRef as React.RefObject<HTMLCanvasElement>;

  const isAnimated = isAnimatedPattern(pattern);

  // Call all hooks but only activate the one that matches the pattern
  useSakuraPetals(animationCanvasRef, darkMode, opacity, pattern === 'sakura-petals');
  useFloatingShields(animationCanvasRef, darkMode, opacity, pattern === 'floating-shields');
  useBitcoinParticles(animationCanvasRef, darkMode, opacity, pattern === 'bitcoin-particles');
  useStackingBlocks(animationCanvasRef, darkMode, opacity, pattern === 'stacking-blocks');
  useDigitalRain(animationCanvasRef, darkMode, opacity, pattern === 'digital-rain');
  useConstellation(animationCanvasRef, darkMode, opacity, pattern === 'constellation');
  useSnowfall(animationCanvasRef, darkMode, opacity, pattern === 'snowfall');
  useSanctuaryLogo(animationCanvasRef, darkMode, opacity, pattern === 'sanctuary-logo');
  useFireflies(animationCanvasRef, darkMode, opacity, pattern === 'fireflies');
  useInkDrops(animationCanvasRef, darkMode, opacity, pattern === 'ink-drops');
  useRipplingWater(animationCanvasRef, darkMode, opacity, pattern === 'rippling-water');
  useFallingLeaves(animationCanvasRef, darkMode, opacity, pattern === 'falling-leaves');
  useEmbersRising(animationCanvasRef, darkMode, opacity, pattern === 'embers-rising');
  useGentleRain(animationCanvasRef, darkMode, opacity, pattern === 'gentle-rain');
  useNorthernLights(animationCanvasRef, darkMode, opacity, pattern === 'northern-lights');
  // Sumi-e animations
  useKoiShadows(animationCanvasRef, darkMode, opacity, pattern === 'koi-shadows');
  useBambooSway(animationCanvasRef, darkMode, opacity, pattern === 'bamboo-sway');
  // Zen & nature animations
  useLotusBloom(animationCanvasRef, darkMode, opacity, pattern === 'lotus-bloom');
  useFloatingLanterns(animationCanvasRef, darkMode, opacity, pattern === 'floating-lanterns');
  useMoonlitClouds(animationCanvasRef, darkMode, opacity, pattern === 'moonlit-clouds');
  useTidePools(animationCanvasRef, darkMode, opacity, pattern === 'tide-pools');
  // Fun animations
  useTrainStation(animationCanvasRef, darkMode, opacity, pattern === 'train-station');
  // Landscape animations
  useSereneMeadows(animationCanvasRef, darkMode, opacity, pattern === 'serene-meadows');
  useStillPonds(animationCanvasRef, darkMode, opacity, pattern === 'still-ponds');
  useDesertDunes(animationCanvasRef, darkMode, opacity, pattern === 'desert-dunes');
  useMountainMist(animationCanvasRef, darkMode, opacity, pattern === 'mountain-mist');
  // Cute animals
  useDucklingParade(animationCanvasRef, darkMode, opacity, pattern === 'duckling-parade');
  useBunnyMeadow(animationCanvasRef, darkMode, opacity, pattern === 'bunny-meadow');
  // Night sky
  useStargazing(animationCanvasRef, darkMode, opacity, pattern === 'stargazing');
  // New serene animations
  useLavenderFields(animationCanvasRef, darkMode, opacity, pattern === 'lavender-fields');
  useZenSandGarden(animationCanvasRef, darkMode, opacity, pattern === 'zen-sand-garden');
  useSunsetSailing(animationCanvasRef, darkMode, opacity, pattern === 'sunset-sailing');
  useRaindropWindow(animationCanvasRef, darkMode, opacity, pattern === 'raindrop-window');
  // Replacement animations
  useButterflyGarden(animationCanvasRef, darkMode, opacity, pattern === 'butterfly-garden');
  useDandelionWishes(animationCanvasRef, darkMode, opacity, pattern === 'dandelion-wishes');
  useMistyValley(animationCanvasRef, darkMode, opacity, pattern === 'misty-valley');
  useGentleWaves(animationCanvasRef, darkMode, opacity, pattern === 'gentle-waves');
  // Additional serene animations
  useJellyfishDrift(animationCanvasRef, darkMode, opacity, pattern === 'jellyfish-drift');
  useWindChimes(animationCanvasRef, darkMode, opacity, pattern === 'wind-chimes');
  useSakuraRedux(animationCanvasRef, darkMode, opacity, pattern === 'sakura-redux');
  useSatsSymbol(animationCanvasRef, darkMode, opacity, pattern === 'sats-symbol');
  useFireworks(animationCanvasRef, darkMode, opacity, pattern === 'fireworks');
  // New animations
  useHashStorm(animationCanvasRef, darkMode, opacity, pattern === 'hash-storm');
  useIceCrystals(animationCanvasRef, darkMode, opacity, pattern === 'ice-crystals');
  useAutumnWind(animationCanvasRef, darkMode, opacity, pattern === 'autumn-wind');
  // Abstract animations
  useSmokeCalligraphy(animationCanvasRef, darkMode, opacity, pattern === 'smoke-calligraphy');
  useBreath(animationCanvasRef, darkMode, opacity, pattern === 'breath');
  useMyceliumNetwork(animationCanvasRef, darkMode, opacity, pattern === 'mycelium-network');
  useOilSlick(animationCanvasRef, darkMode, opacity, pattern === 'oil-slick');
  // New landscape/nature animations
  useBioluminescentBeach(animationCanvasRef, darkMode, opacity, pattern === 'bioluminescent-beach');
  useVolcanicIslands(animationCanvasRef, darkMode, opacity, pattern === 'volcanic-islands');
  useTidalPatterns(animationCanvasRef, darkMode, opacity, pattern === 'tidal-patterns');
  useEclipse(animationCanvasRef, darkMode, opacity, pattern === 'eclipse');
  usePaperBoats(animationCanvasRef, darkMode, opacity, pattern === 'paper-boats');
  usePaperAirplanes(animationCanvasRef, darkMode, opacity, pattern === 'paper-airplanes');
  useThunderstorm(animationCanvasRef, darkMode, opacity, pattern === 'thunderstorm');

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
