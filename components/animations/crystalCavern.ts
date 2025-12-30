/**
 * Crystal Cavern Animation
 *
 * Sparkling crystal formations in a mystical underground cave.
 * Crystals glow and shimmer with subtle light effects.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface Crystal {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  hue: number;
  saturation: number;
  lightness: number;
  glowPhase: number;
  glowSpeed: number;
  facets: { angle: number; length: number }[];
  isHanging: boolean;
}

interface Sparkle {
  x: number;
  y: number;
  phase: number;
  speed: number;
  size: number;
  maxOpacity: number;
}

interface AmbientGlow {
  x: number;
  y: number;
  radius: number;
  hue: number;
  phase: number;
}

export function useCrystalCavern(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const crystalsRef = useRef<Crystal[]>([]);
  const sparklesRef = useRef<Sparkle[]>([]);
  const glowsRef = useRef<AmbientGlow[]>([]);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initializeElements();
    };

    const initializeElements = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Create crystals - mix of floor and ceiling
      crystalsRef.current = [];

      // Floor crystals (larger clusters)
      for (let i = 0; i < 8; i++) {
        const clusterX = width * 0.1 + Math.random() * width * 0.8;
        const clusterY = height * 0.7 + Math.random() * height * 0.25;
        const crystalCount = 2 + Math.floor(Math.random() * 4);

        for (let c = 0; c < crystalCount; c++) {
          crystalsRef.current.push(createCrystal(
            clusterX + (Math.random() - 0.5) * 60,
            clusterY,
            false
          ));
        }
      }

      // Ceiling crystals (stalactites)
      for (let i = 0; i < 6; i++) {
        const clusterX = width * 0.1 + Math.random() * width * 0.8;
        const crystalCount = 1 + Math.floor(Math.random() * 3);

        for (let c = 0; c < crystalCount; c++) {
          crystalsRef.current.push(createCrystal(
            clusterX + (Math.random() - 0.5) * 40,
            Math.random() * height * 0.1,
            true
          ));
        }
      }

      // Create sparkles
      sparklesRef.current = [];
      for (let i = 0; i < 40; i++) {
        sparklesRef.current.push({
          x: Math.random() * width,
          y: Math.random() * height,
          phase: Math.random() * Math.PI * 2,
          speed: 0.02 + Math.random() * 0.03,
          size: 1 + Math.random() * 2,
          maxOpacity: 0.3 + Math.random() * 0.5,
        });
      }

      // Create ambient glows
      glowsRef.current = [];
      for (let i = 0; i < 5; i++) {
        glowsRef.current.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: 100 + Math.random() * 150,
          hue: 180 + Math.random() * 100, // Cyan to purple
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const createCrystal = (x: number, y: number, isHanging: boolean): Crystal => {
      const facetCount = 4 + Math.floor(Math.random() * 3);
      const facets: { angle: number; length: number }[] = [];

      for (let f = 0; f < facetCount; f++) {
        facets.push({
          angle: ((f / facetCount) * Math.PI - Math.PI / 2) * 0.6,
          length: 0.3 + Math.random() * 0.4,
        });
      }

      return {
        x,
        y,
        width: 15 + Math.random() * 25,
        height: 40 + Math.random() * 80,
        angle: (Math.random() - 0.5) * 0.4,
        hue: 180 + Math.random() * 80, // Cyan to purple range
        saturation: 40 + Math.random() * 30,
        lightness: 50 + Math.random() * 20,
        glowPhase: Math.random() * Math.PI * 2,
        glowSpeed: 0.005 + Math.random() * 0.01,
        facets,
        isHanging,
      };
    };

    const drawBackground = () => {
      const gradient = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.8
      );

      if (darkMode) {
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.5, '#0f0f1a');
        gradient.addColorStop(1, '#050508');
      } else {
        gradient.addColorStop(0, '#2a2a3e');
        gradient.addColorStop(0.5, '#1a1a2a');
        gradient.addColorStop(1, '#0a0a15');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw cave walls texture
      ctx.fillStyle = darkMode ? '#15151f' : '#1f1f2a';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = 0; x <= canvas.width; x += 30) {
        const y = Math.sin(x * 0.02) * 30 + Math.sin(x * 0.01) * 20;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(canvas.width, 0);
      ctx.closePath();
      ctx.fill();

      // Bottom rocks
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (let x = 0; x <= canvas.width; x += 30) {
        const y = canvas.height - Math.sin(x * 0.015 + 2) * 25 - Math.sin(x * 0.008) * 40 - 20;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(canvas.width, canvas.height);
      ctx.closePath();
      ctx.fill();
    };

    const drawAmbientGlows = (time: number) => {
      glowsRef.current.forEach((glow) => {
        const pulse = Math.sin(time * 0.001 + glow.phase) * 0.3 + 0.7;
        const gradient = ctx.createRadialGradient(
          glow.x,
          glow.y,
          0,
          glow.x,
          glow.y,
          glow.radius
        );

        gradient.addColorStop(0, `hsla(${glow.hue}, 60%, 50%, ${0.15 * pulse})`);
        gradient.addColorStop(0.5, `hsla(${glow.hue}, 60%, 40%, ${0.08 * pulse})`);
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.fillRect(
          glow.x - glow.radius,
          glow.y - glow.radius,
          glow.radius * 2,
          glow.radius * 2
        );
      });
    };

    const drawCrystal = (crystal: Crystal, time: number) => {
      ctx.save();
      ctx.translate(crystal.x, crystal.y);
      ctx.rotate(crystal.angle);

      const glowIntensity = Math.sin(time * crystal.glowSpeed + crystal.glowPhase) * 0.3 + 0.7;
      const direction = crystal.isHanging ? 1 : -1;

      // Crystal glow
      const glowGradient = ctx.createRadialGradient(
        0,
        direction * crystal.height * 0.3,
        0,
        0,
        direction * crystal.height * 0.3,
        crystal.width * 2
      );
      glowGradient.addColorStop(
        0,
        `hsla(${crystal.hue}, ${crystal.saturation}%, ${crystal.lightness}%, ${0.4 * glowIntensity})`
      );
      glowGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGradient;
      ctx.fillRect(
        -crystal.width * 2,
        direction * (-crystal.height * 0.2),
        crystal.width * 4,
        crystal.height * 1.2
      );

      // Main crystal body
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-crystal.width * 0.5, direction * crystal.height * 0.3);
      ctx.lineTo(-crystal.width * 0.3, direction * crystal.height * 0.7);
      ctx.lineTo(0, direction * crystal.height);
      ctx.lineTo(crystal.width * 0.3, direction * crystal.height * 0.7);
      ctx.lineTo(crystal.width * 0.5, direction * crystal.height * 0.3);
      ctx.closePath();

      const crystalGradient = ctx.createLinearGradient(
        -crystal.width * 0.5,
        0,
        crystal.width * 0.5,
        direction * crystal.height
      );
      crystalGradient.addColorStop(
        0,
        `hsla(${crystal.hue}, ${crystal.saturation}%, ${crystal.lightness + 20}%, ${0.8 * glowIntensity})`
      );
      crystalGradient.addColorStop(
        0.5,
        `hsla(${crystal.hue}, ${crystal.saturation}%, ${crystal.lightness}%, ${0.6 * glowIntensity})`
      );
      crystalGradient.addColorStop(
        1,
        `hsla(${crystal.hue - 20}, ${crystal.saturation}%, ${crystal.lightness - 10}%, ${0.7 * glowIntensity})`
      );
      ctx.fillStyle = crystalGradient;
      ctx.fill();

      // Highlight edge
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(crystal.width * 0.3, direction * crystal.height * 0.7);
      ctx.lineTo(0, direction * crystal.height);
      ctx.strokeStyle = `hsla(${crystal.hue}, 80%, 80%, ${0.5 * glowIntensity})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    };

    const drawSparkles = (time: number) => {
      sparklesRef.current.forEach((sparkle) => {
        const opacity = Math.sin(time * sparkle.speed + sparkle.phase);
        if (opacity > 0) {
          const size = sparkle.size * opacity;
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity * sparkle.maxOpacity})`;

          // Draw star shape
          ctx.beginPath();
          ctx.moveTo(sparkle.x, sparkle.y - size);
          ctx.lineTo(sparkle.x + size * 0.3, sparkle.y - size * 0.3);
          ctx.lineTo(sparkle.x + size, sparkle.y);
          ctx.lineTo(sparkle.x + size * 0.3, sparkle.y + size * 0.3);
          ctx.lineTo(sparkle.x, sparkle.y + size);
          ctx.lineTo(sparkle.x - size * 0.3, sparkle.y + size * 0.3);
          ctx.lineTo(sparkle.x - size, sparkle.y);
          ctx.lineTo(sparkle.x - size * 0.3, sparkle.y - size * 0.3);
          ctx.closePath();
          ctx.fill();
        }
      });
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();
      drawAmbientGlows(time);

      // Draw crystals (sorted by Y for depth)
      const sortedCrystals = [...crystalsRef.current].sort((a, b) => {
        if (a.isHanging !== b.isHanging) return a.isHanging ? -1 : 1;
        return a.y - b.y;
      });
      sortedCrystals.forEach((crystal) => drawCrystal(crystal, time));

      drawSparkles(time);

      animationRef.current = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, [canvasRef, darkMode, opacity, active]);
}
