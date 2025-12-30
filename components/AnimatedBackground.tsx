/**
 * Animated Background Component
 *
 * Renders canvas-based animated backgrounds for special patterns.
 * Supports multiple animation types for different visual effects.
 */

import React, { useRef, useEffect, useCallback } from 'react';

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
] as const;

export type AnimatedPatternId = typeof ANIMATED_PATTERNS[number];

export function isAnimatedPattern(pattern: string): pattern is AnimatedPatternId {
  return ANIMATED_PATTERNS.includes(pattern as AnimatedPatternId);
}

// ============================================================================
// SAKURA PETALS ANIMATION
// ============================================================================

interface Petal {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  fallSpeed: number;
  swayAmplitude: number;
  swaySpeed: number;
  swayOffset: number;
  opacity: number;
  variant: number;
}

function useSakuraPetals(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const petalsRef = useRef<Petal[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createPetal = useCallback((canvas: HTMLCanvasElement, startFromTop = true): Petal => {
    return {
      x: Math.random() * canvas.width,
      y: startFromTop ? -20 : Math.random() * canvas.height,
      size: 8 + Math.random() * 12,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.02,
      fallSpeed: 0.3 + Math.random() * 0.5,
      swayAmplitude: 30 + Math.random() * 40,
      swaySpeed: 0.5 + Math.random() * 0.5,
      swayOffset: Math.random() * Math.PI * 2,
      opacity: 0.4 + Math.random() * 0.4,
      variant: Math.floor(Math.random() * 3),
    };
  }, []);

  const drawPetal = useCallback((
    ctx: CanvasRenderingContext2D,
    petal: Petal,
    isDark: boolean,
    opacityMultiplier: number
  ) => {
    ctx.save();
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.rotation);

    const baseColor = isDark
      ? { r: 248, g: 180, b: 200 }
      : { r: 255, g: 192, b: 203 };

    const alpha = petal.opacity * opacityMultiplier;
    ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;

    ctx.beginPath();
    const s = petal.size;

    switch (petal.variant) {
      case 0:
        ctx.moveTo(0, -s / 2);
        ctx.bezierCurveTo(s / 2, -s / 2, s / 2, s / 4, 0, s / 2);
        ctx.bezierCurveTo(-s / 2, s / 4, -s / 2, -s / 2, 0, -s / 2);
        break;
      case 1:
        ctx.ellipse(0, 0, s / 2, s / 3, 0, 0, Math.PI * 2);
        break;
      case 2:
        ctx.moveTo(0, -s / 3);
        ctx.bezierCurveTo(s / 2, -s / 2, s / 2, 0, 0, s / 2);
        ctx.bezierCurveTo(-s / 2, 0, -s / 2, -s / 2, 0, -s / 3);
        break;
    }

    ctx.fill();

    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.3})`);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.restore();
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const petalCount = Math.floor((canvas.width * canvas.height) / 25000);
    petalsRef.current = Array.from({ length: petalCount }, () =>
      createPetal(canvas, false)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      petalsRef.current.forEach((petal, index) => {
        petal.y += petal.fallSpeed;
        petal.x += Math.sin(timeRef.current * petal.swaySpeed + petal.swayOffset) * 0.5;
        petal.rotation += petal.rotationSpeed;

        const sway = Math.sin(timeRef.current * petal.swaySpeed + petal.swayOffset);
        petal.x += sway * 0.3;

        if (petal.y > canvas.height + 20 || petal.x < -50 || petal.x > canvas.width + 50) {
          petalsRef.current[index] = createPetal(canvas, true);
        }

        drawPetal(ctx, petal, darkMode, opacityMultiplier);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createPetal, drawPetal, active]);
}

// ============================================================================
// FLOATING SHIELDS ANIMATION
// ============================================================================

interface Shield {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  vx: number;
  vy: number;
  opacity: number;
  pulsePhase: number;
}

function useFloatingShields(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const shieldsRef = useRef<Shield[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createShield = useCallback((canvas: HTMLCanvasElement): Shield => {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: 20 + Math.random() * 30,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.005,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      opacity: 0.3 + Math.random() * 0.3,
      pulsePhase: Math.random() * Math.PI * 2,
    };
  }, []);

  const drawShield = useCallback((
    ctx: CanvasRenderingContext2D,
    shield: Shield,
    isDark: boolean,
    opacityMultiplier: number,
    time: number
  ) => {
    ctx.save();
    ctx.translate(shield.x, shield.y);
    ctx.rotate(shield.rotation);

    const pulse = 1 + Math.sin(time * 2 + shield.pulsePhase) * 0.1;
    const s = shield.size * pulse;

    // Shield colors - golden/bronze for protection feel
    const baseColor = isDark
      ? { r: 218, g: 165, b: 32 }   // Gold
      : { r: 184, g: 134, b: 11 };  // Dark goldenrod

    const alpha = shield.opacity * opacityMultiplier;

    // Draw shield shape
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.6);
    ctx.bezierCurveTo(s * 0.5, -s * 0.5, s * 0.5, s * 0.2, 0, s * 0.6);
    ctx.bezierCurveTo(-s * 0.5, s * 0.2, -s * 0.5, -s * 0.5, 0, -s * 0.6);
    ctx.closePath();

    // Fill with gradient
    const gradient = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.6);
    gradient.addColorStop(0, `rgba(${baseColor.r + 40}, ${baseColor.g + 40}, ${baseColor.b + 20}, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`);
    gradient.addColorStop(1, `rgba(${baseColor.r - 40}, ${baseColor.g - 40}, ${baseColor.b}, ${alpha * 0.8})`);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw cross on shield
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.3);
    ctx.lineTo(0, s * 0.3);
    ctx.moveTo(-s * 0.2, 0);
    ctx.lineTo(s * 0.2, 0);
    ctx.stroke();

    ctx.restore();
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const shieldCount = Math.floor((canvas.width * canvas.height) / 80000);
    shieldsRef.current = Array.from({ length: Math.max(5, shieldCount) }, () =>
      createShield(canvas)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      shieldsRef.current.forEach((shield) => {
        shield.x += shield.vx;
        shield.y += shield.vy;
        shield.rotation += shield.rotationSpeed;

        // Wrap around edges
        if (shield.x < -50) shield.x = canvas.width + 50;
        if (shield.x > canvas.width + 50) shield.x = -50;
        if (shield.y < -50) shield.y = canvas.height + 50;
        if (shield.y > canvas.height + 50) shield.y = -50;

        drawShield(ctx, shield, darkMode, opacityMultiplier, timeRef.current);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createShield, drawShield, active]);
}

// ============================================================================
// BITCOIN PARTICLES ANIMATION
// ============================================================================

interface BitcoinParticle {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  vx: number;
  vy: number;
  opacity: number;
  fadeDirection: number;
}

function useBitcoinParticles(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const particlesRef = useRef<BitcoinParticle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);

  const createParticle = useCallback((canvas: HTMLCanvasElement): BitcoinParticle => {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: 12 + Math.random() * 20,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.01,
      vx: (Math.random() - 0.5) * 0.2,
      vy: -0.2 - Math.random() * 0.3, // Float upward
      opacity: Math.random() * 0.5,
      fadeDirection: 1,
    };
  }, []);

  const drawBitcoin = useCallback((
    ctx: CanvasRenderingContext2D,
    particle: BitcoinParticle,
    isDark: boolean,
    opacityMultiplier: number
  ) => {
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rotation);

    const s = particle.size;
    const alpha = particle.opacity * opacityMultiplier;

    // Bitcoin orange color
    const baseColor = isDark
      ? { r: 247, g: 147, b: 26 }   // Bitcoin orange
      : { r: 242, g: 169, b: 0 };   // Slightly muted orange

    // Draw circle background
    ctx.beginPath();
    ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha * 0.3})`;
    ctx.fill();

    // Draw Bitcoin symbol (₿)
    ctx.font = `bold ${s * 0.7}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;
    ctx.fillText('₿', 0, 0);

    // Add glow effect
    ctx.shadowColor = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha * 0.5})`;
    ctx.shadowBlur = 10;
    ctx.fillText('₿', 0, 0);

    ctx.restore();
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const particleCount = Math.floor((canvas.width * canvas.height) / 50000);
    particlesRef.current = Array.from({ length: Math.max(8, particleCount) }, () =>
      createParticle(canvas)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const opacityMultiplier = opacity / 50;

      particlesRef.current.forEach((particle, index) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.rotationSpeed;

        // Fade in and out
        particle.opacity += particle.fadeDirection * 0.005;
        if (particle.opacity >= 0.6) particle.fadeDirection = -1;
        if (particle.opacity <= 0) {
          particlesRef.current[index] = createParticle(canvas);
          particlesRef.current[index].y = canvas.height + 20;
        }

        // Reset if off screen
        if (particle.y < -50) {
          particlesRef.current[index] = createParticle(canvas);
          particlesRef.current[index].y = canvas.height + 20;
        }

        drawBitcoin(ctx, particle, darkMode, opacityMultiplier);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createParticle, drawBitcoin, active]);
}

// ============================================================================
// STACKING BLOCKS ANIMATION (Bitcoin blocks being stacked)
// ============================================================================

interface Block {
  x: number;
  y: number;
  targetY: number;
  size: number;
  rotation: number;
  opacity: number;
  settled: boolean;
  settleTime: number;
  column: number;
}

function useStackingBlocks(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const blocksRef = useRef<Block[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);
  const columnHeightsRef = useRef<number[]>([]);

  const createBlock = useCallback((canvas: HTMLCanvasElement, column: number, columnHeights: number[]): Block => {
    const size = 25 + Math.random() * 15;
    const targetY = canvas.height - columnHeights[column] - size / 2;

    return {
      x: (column + 0.5) * (canvas.width / columnHeights.length),
      y: -size,
      targetY,
      size,
      rotation: (Math.random() - 0.5) * 0.1,
      opacity: 0.2 + Math.random() * 0.2,
      settled: false,
      settleTime: 0,
      column,
    };
  }, []);

  const drawBlock = useCallback((
    ctx: CanvasRenderingContext2D,
    block: Block,
    isDark: boolean,
    opacityMultiplier: number,
    time: number
  ) => {
    ctx.save();
    ctx.translate(block.x, block.y);
    ctx.rotate(block.rotation);

    const s = block.size;
    let alpha = block.opacity * opacityMultiplier;

    // Fade out after settling (longer duration for more stacking)
    if (block.settled) {
      const fadeTime = time - block.settleTime;
      alpha *= Math.max(0, 1 - fadeTime / 25); // Increased from 8 to 25 seconds
    }

    // Golden block color (matching Sanctuary theme)
    const baseColor = isDark
      ? { r: 180, g: 140, b: 40 }
      : { r: 160, g: 120, b: 30 };

    // Draw 3D block effect
    // Top face
    ctx.fillStyle = `rgba(${baseColor.r + 40}, ${baseColor.g + 30}, ${baseColor.b + 20}, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(-s / 2, -s / 4);
    ctx.lineTo(0, -s / 2);
    ctx.lineTo(s / 2, -s / 4);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();

    // Left face
    ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(-s / 2, -s / 4);
    ctx.lineTo(0, 0);
    ctx.lineTo(0, s / 2);
    ctx.lineTo(-s / 2, s / 4);
    ctx.closePath();
    ctx.fill();

    // Right face
    ctx.fillStyle = `rgba(${baseColor.r - 30}, ${baseColor.g - 20}, ${baseColor.b}, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(s / 2, -s / 4);
    ctx.lineTo(0, 0);
    ctx.lineTo(0, s / 2);
    ctx.lineTo(s / 2, s / 4);
    ctx.closePath();
    ctx.fill();

    // Draw subtle "B" on top face
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
    ctx.font = `bold ${s * 0.25}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₿', 0, -s / 5);

    ctx.restore();
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initialize columns
    const columnCount = Math.floor(canvas.width / 80);
    columnHeightsRef.current = Array(columnCount).fill(0);

    // Start with a few blocks
    blocksRef.current = [];
    for (let i = 0; i < 3; i++) {
      const col = Math.floor(Math.random() * columnCount);
      const block = createBlock(canvas, col, columnHeightsRef.current);
      block.y = block.targetY; // Start already placed
      block.settled = true;
      block.settleTime = -5; // Already fading
      columnHeightsRef.current[col] += block.size;
      blocksRef.current.push(block);
    }

    let lastBlockTime = 0;

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      // Spawn new blocks periodically
      if (timeRef.current - lastBlockTime > 2 + Math.random() * 3) {
        const col = Math.floor(Math.random() * columnHeightsRef.current.length);
        if (columnHeightsRef.current[col] < canvas.height * 0.6) {
          blocksRef.current.push(createBlock(canvas, col, columnHeightsRef.current));
          lastBlockTime = timeRef.current;
        }
      }

      // Update and draw blocks
      blocksRef.current = blocksRef.current.filter((block) => {
        // Animate falling
        if (!block.settled) {
          block.y += 2;
          if (block.y >= block.targetY) {
            block.y = block.targetY;
            block.settled = true;
            block.settleTime = timeRef.current;
            columnHeightsRef.current[block.column] += block.size;
          }
        }

        // Remove faded blocks (after longer display time)
        if (block.settled) {
          const fadeTime = timeRef.current - block.settleTime;
          if (fadeTime > 30) { // Increased from 10 to 30 seconds
            columnHeightsRef.current[block.column] = Math.max(
              0,
              columnHeightsRef.current[block.column] - block.size
            );
            return false;
          }
        }

        drawBlock(ctx, block, darkMode, opacityMultiplier, timeRef.current);
        return true;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createBlock, drawBlock, active]);
}

// ============================================================================
// DIGITAL RAIN ANIMATION (Subtle version)
// ============================================================================

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  chars: string[];
  charIndex: number;
  opacity: number;
  length: number;
}

function useDigitalRain(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const dropsRef = useRef<RainDrop[]>([]);
  const animationRef = useRef<number | undefined>(undefined);

  const chars = '01₿SATOSHI'.split('');

  const createDrop = useCallback((canvas: HTMLCanvasElement, startFromTop = true): RainDrop => {
    const length = 5 + Math.floor(Math.random() * 15);
    return {
      x: Math.floor(Math.random() * (canvas.width / 16)) * 16,
      y: startFromTop ? -length * 16 : Math.random() * canvas.height,
      speed: 0.5 + Math.random() * 1, // Slower speed
      chars: Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]),
      charIndex: 0,
      opacity: 0.08 + Math.random() * 0.12, // Much lower base opacity
      length,
    };
  }, [chars]);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Fewer drops for subtlety
    const dropCount = Math.floor(canvas.width / 50);
    dropsRef.current = Array.from({ length: dropCount }, () =>
      createDrop(canvas, false)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      // Clear with very subtle fade for trailing effect
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const opacityMultiplier = opacity / 50;

      ctx.font = '11px monospace';

      dropsRef.current.forEach((drop, index) => {
        // Draw characters
        for (let i = 0; i < drop.length; i++) {
          const charY = drop.y - i * 16;
          if (charY < 0 || charY > canvas.height) continue;

          const fadeRatio = 1 - i / drop.length;
          const alpha = drop.opacity * fadeRatio * opacityMultiplier;

          // Subtle monochrome with hint of color
          if (i === 0) {
            // Lead character slightly brighter
            ctx.fillStyle = darkMode
              ? `rgba(140, 160, 140, ${alpha * 1.2})`  // Subtle grayish-green
              : `rgba(100, 120, 100, ${alpha * 1.2})`;
          } else {
            ctx.fillStyle = darkMode
              ? `rgba(120, 140, 120, ${alpha})`  // Very muted gray-green
              : `rgba(80, 100, 80, ${alpha})`;
          }

          ctx.fillText(drop.chars[i], drop.x, charY);
        }

        drop.y += drop.speed;

        // Randomly change characters (less frequently)
        if (Math.random() < 0.01) {
          const changeIndex = Math.floor(Math.random() * drop.length);
          drop.chars[changeIndex] = chars[Math.floor(Math.random() * chars.length)];
        }

        // Reset if off screen
        if (drop.y > canvas.height + drop.length * 16) {
          dropsRef.current[index] = createDrop(canvas, true);
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createDrop, chars, active]);
}

// ============================================================================
// CONSTELLATION NETWORK ANIMATION
// ============================================================================

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  connections: number[];
  pulsePhase: number;
}

function useConstellation(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const nodesRef = useRef<Node[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createNode = useCallback((canvas: HTMLCanvasElement): Node => {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: 2 + Math.random() * 3,
      connections: [],
      pulsePhase: Math.random() * Math.PI * 2,
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const nodeCount = Math.floor((canvas.width * canvas.height) / 30000);
    nodesRef.current = Array.from({ length: Math.max(20, nodeCount) }, () =>
      createNode(canvas)
    );

    const connectionDistance = 150;

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;
      const nodes = nodesRef.current;

      // Update positions
      nodes.forEach((node) => {
        node.x += node.vx;
        node.y += node.vy;

        // Bounce off edges
        if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;

        // Keep in bounds
        node.x = Math.max(0, Math.min(canvas.width, node.x));
        node.y = Math.max(0, Math.min(canvas.height, node.y));
      });

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < connectionDistance) {
            const lineOpacity = (1 - distance / connectionDistance) * 0.3 * opacityMultiplier;

            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = darkMode
              ? `rgba(150, 180, 255, ${lineOpacity})`
              : `rgba(70, 100, 180, ${lineOpacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      nodes.forEach((node) => {
        const pulse = 1 + Math.sin(timeRef.current * 2 + node.pulsePhase) * 0.3;
        const size = node.size * pulse;

        // Glow
        const gradient = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, size * 3
        );

        if (darkMode) {
          gradient.addColorStop(0, `rgba(150, 180, 255, ${0.4 * opacityMultiplier})`);
          gradient.addColorStop(1, 'rgba(150, 180, 255, 0)');
        } else {
          gradient.addColorStop(0, `rgba(70, 100, 180, ${0.3 * opacityMultiplier})`);
          gradient.addColorStop(1, 'rgba(70, 100, 180, 0)');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = darkMode
          ? `rgba(200, 220, 255, ${0.8 * opacityMultiplier})`
          : `rgba(50, 80, 150, ${0.8 * opacityMultiplier})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
        ctx.fill();
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createNode, active]);
}

// ============================================================================
// SANCTUARY LOGO ANIMATION (Scattered across screen)
// ============================================================================

interface ScatteredLogo {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  pulsePhase: number;
  driftX: number;
  driftY: number;
  driftPhaseX: number;
  driftPhaseY: number;
}

// Draw the Sanctuary stacked hexagon logo
function drawSanctuaryLogo(
  ctx: CanvasRenderingContext2D,
  size: number,
  isDark: boolean,
  alpha: number
) {
  // Golden color from the SVG: #D4A017
  const goldColor = { r: 212, g: 160, b: 23 };
  const strokeColor = `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha})`;
  const fillColor = `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha * 0.3})`;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const scale = size / 20; // Original logo is ~20 units

  // Top diamond (main shape)
  ctx.beginPath();
  ctx.moveTo(0, -10 * scale);          // Top
  ctx.lineTo(-10 * scale, -5 * scale); // Left
  ctx.lineTo(0, 0);                     // Center
  ctx.lineTo(10 * scale, -5 * scale);  // Right
  ctx.closePath();
  ctx.stroke();

  // Middle layer
  ctx.beginPath();
  ctx.moveTo(-10 * scale, 0);
  ctx.lineTo(0, 5 * scale);
  ctx.lineTo(10 * scale, 0);
  ctx.stroke();

  // Bottom layer
  ctx.beginPath();
  ctx.moveTo(-10 * scale, 5 * scale);
  ctx.lineTo(0, 10 * scale);
  ctx.lineTo(10 * scale, 5 * scale);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(0, 0, 1 * scale, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Add outer glow
  const glowSize = size * 1.2;
  const gradient = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, glowSize);
  gradient.addColorStop(0, `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha * 0.1})`);
  gradient.addColorStop(0.6, `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha * 0.03})`);
  gradient.addColorStop(1, `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, glowSize, 0, Math.PI * 2);
  ctx.fill();
}

function useSanctuaryLogo(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const logosRef = useRef<ScatteredLogo[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createLogo = useCallback((canvas: HTMLCanvasElement): ScatteredLogo => {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: 20 + Math.random() * 40,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.003,
      opacity: 0.15 + Math.random() * 0.25,
      pulsePhase: Math.random() * Math.PI * 2,
      driftX: 15 + Math.random() * 25,
      driftY: 10 + Math.random() * 20,
      driftPhaseX: Math.random() * Math.PI * 2,
      driftPhaseY: Math.random() * Math.PI * 2,
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Create scattered logos across the screen
    const logoCount = Math.floor((canvas.width * canvas.height) / 80000);
    logosRef.current = Array.from({ length: Math.max(8, logoCount) }, () =>
      createLogo(canvas)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      logosRef.current.forEach((logo) => {
        // Gentle drifting motion
        const currentX = logo.x + Math.sin(timeRef.current * 0.2 + logo.driftPhaseX) * logo.driftX;
        const currentY = logo.y + Math.cos(timeRef.current * 0.15 + logo.driftPhaseY) * logo.driftY;

        // Slow rotation
        logo.rotation += logo.rotationSpeed;

        // Pulsing opacity
        const pulseOpacity = logo.opacity + Math.sin(timeRef.current * 0.5 + logo.pulsePhase) * 0.08;
        const pulseScale = 1 + Math.sin(timeRef.current * 0.3 + logo.pulsePhase) * 0.05;

        ctx.save();
        ctx.translate(currentX, currentY);
        ctx.rotate(logo.rotation);
        ctx.scale(pulseScale, pulseScale);

        drawSanctuaryLogo(ctx, logo.size, darkMode, pulseOpacity * opacityMultiplier);

        ctx.restore();
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createLogo, active]);
}

// ============================================================================
// SNOWFALL ANIMATION
// ============================================================================

interface Snowflake {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  wobblePhase: number;
  wobbleSpeed: number;
  rotation: number;
  rotationSpeed: number;
  variant: number; // 0 = circle, 1 = star, 2 = crystal
}

function useSnowfall(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const snowflakesRef = useRef<Snowflake[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createSnowflake = useCallback((canvas: HTMLCanvasElement, startFromTop = true): Snowflake => {
    return {
      x: Math.random() * canvas.width,
      y: startFromTop ? -10 : Math.random() * canvas.height,
      size: 2 + Math.random() * 6,
      speed: 0.3 + Math.random() * 0.7,
      opacity: 0.3 + Math.random() * 0.5,
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.5 + Math.random() * 1,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.02,
      variant: Math.floor(Math.random() * 3),
    };
  }, []);

  const drawSnowflake = useCallback((
    ctx: CanvasRenderingContext2D,
    flake: Snowflake,
    isDark: boolean,
    opacityMultiplier: number
  ) => {
    ctx.save();
    ctx.translate(flake.x, flake.y);
    ctx.rotate(flake.rotation);

    const alpha = flake.opacity * opacityMultiplier;
    const color = isDark
      ? `rgba(255, 255, 255, ${alpha})`
      : `rgba(180, 200, 220, ${alpha})`;

    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    const s = flake.size;

    switch (flake.variant) {
      case 0:
        // Simple circle snowflake
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 1:
        // 6-pointed star
        ctx.lineWidth = s * 0.15;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(angle) * s, Math.sin(angle) * s);
          ctx.stroke();
        }
        break;

      case 2:
        // Crystal with branches
        ctx.lineWidth = s * 0.12;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);

          // Main branch
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(cos * s, sin * s);
          ctx.stroke();

          // Small side branches
          const branchLen = s * 0.4;
          const branchPos = s * 0.6;
          ctx.beginPath();
          ctx.moveTo(cos * branchPos, sin * branchPos);
          ctx.lineTo(
            cos * branchPos + Math.cos(angle + 0.5) * branchLen,
            sin * branchPos + Math.sin(angle + 0.5) * branchLen
          );
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cos * branchPos, sin * branchPos);
          ctx.lineTo(
            cos * branchPos + Math.cos(angle - 0.5) * branchLen,
            sin * branchPos + Math.sin(angle - 0.5) * branchLen
          );
          ctx.stroke();
        }
        break;
    }

    ctx.restore();
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Create initial snowflakes
    const flakeCount = Math.floor((canvas.width * canvas.height) / 15000);
    snowflakesRef.current = Array.from({ length: flakeCount }, () =>
      createSnowflake(canvas, false)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      snowflakesRef.current.forEach((flake, index) => {
        // Gentle falling
        flake.y += flake.speed;

        // Side-to-side wobble
        flake.x += Math.sin(timeRef.current * flake.wobbleSpeed + flake.wobblePhase) * 0.3;

        // Slow rotation
        flake.rotation += flake.rotationSpeed;

        // Reset if off screen
        if (flake.y > canvas.height + 20 || flake.x < -20 || flake.x > canvas.width + 20) {
          snowflakesRef.current[index] = createSnowflake(canvas, true);
        }

        drawSnowflake(ctx, flake, darkMode, opacityMultiplier);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createSnowflake, drawSnowflake, active]);
}

// ============================================================================
// FIREFLIES ANIMATION
// ============================================================================

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  glowPhase: number;
  glowSpeed: number;
  maxBrightness: number;
  driftPhase: number;
}

function useFireflies(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const firefliesRef = useRef<Firefly[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createFirefly = useCallback((canvas: HTMLCanvasElement): Firefly => {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: 2 + Math.random() * 3,
      glowPhase: Math.random() * Math.PI * 2,
      glowSpeed: 0.5 + Math.random() * 1.5,
      maxBrightness: 0.4 + Math.random() * 0.5,
      driftPhase: Math.random() * Math.PI * 2,
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const fireflyCount = Math.floor((canvas.width * canvas.height) / 40000);
    firefliesRef.current = Array.from({ length: Math.max(15, fireflyCount) }, () =>
      createFirefly(canvas)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      firefliesRef.current.forEach((firefly) => {
        // Gentle drifting movement
        firefly.x += firefly.vx + Math.sin(timeRef.current * 0.5 + firefly.driftPhase) * 0.2;
        firefly.y += firefly.vy + Math.cos(timeRef.current * 0.3 + firefly.driftPhase) * 0.15;

        // Wrap around edges
        if (firefly.x < -20) firefly.x = canvas.width + 20;
        if (firefly.x > canvas.width + 20) firefly.x = -20;
        if (firefly.y < -20) firefly.y = canvas.height + 20;
        if (firefly.y > canvas.height + 20) firefly.y = -20;

        // Pulsing glow (firefly-like fade in/out)
        const glowCycle = Math.sin(timeRef.current * firefly.glowSpeed + firefly.glowPhase);
        const brightness = Math.max(0, glowCycle) * firefly.maxBrightness;

        if (brightness > 0.05) {
          // Warm yellow-green glow color
          const warmColor = darkMode
            ? { r: 255, g: 230, b: 100 }
            : { r: 200, g: 180, b: 50 };

          // Outer glow
          const glowSize = firefly.size * 4 * (0.5 + brightness * 0.5);
          const gradient = ctx.createRadialGradient(
            firefly.x, firefly.y, 0,
            firefly.x, firefly.y, glowSize
          );
          gradient.addColorStop(0, `rgba(${warmColor.r}, ${warmColor.g}, ${warmColor.b}, ${brightness * 0.6 * opacityMultiplier})`);
          gradient.addColorStop(0.4, `rgba(${warmColor.r}, ${warmColor.g}, ${warmColor.b}, ${brightness * 0.2 * opacityMultiplier})`);
          gradient.addColorStop(1, `rgba(${warmColor.r}, ${warmColor.g}, ${warmColor.b}, 0)`);

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(firefly.x, firefly.y, glowSize, 0, Math.PI * 2);
          ctx.fill();

          // Bright core
          ctx.fillStyle = `rgba(255, 255, 200, ${brightness * opacityMultiplier})`;
          ctx.beginPath();
          ctx.arc(firefly.x, firefly.y, firefly.size * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createFirefly, active]);
}

// ============================================================================
// INK DROPS ANIMATION
// ============================================================================

interface InkDrop {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  color: { r: number; g: number; b: number };
  tendrils: Array<{
    angle: number;
    length: number;
    speed: number;
    wobble: number;
  }>;
  age: number;
  fadeStart: number;
}

function useInkDrops(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const dropsRef = useRef<InkDrop[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);
  const lastDropTimeRef = useRef<number>(0);

  const inkColors = darkMode
    ? [
        { r: 100, g: 140, b: 180 }, // Blue
        { r: 130, g: 100, b: 160 }, // Purple
        { r: 80, g: 120, b: 140 },  // Teal
      ]
    : [
        { r: 60, g: 80, b: 120 },   // Deep blue
        { r: 90, g: 60, b: 110 },   // Deep purple
        { r: 40, g: 80, b: 100 },   // Deep teal
      ];

  const createDrop = useCallback((canvas: HTMLCanvasElement): InkDrop => {
    const tendrilCount = 4 + Math.floor(Math.random() * 4);
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: 0,
      maxRadius: 40 + Math.random() * 80,
      opacity: 0.08 + Math.random() * 0.08,
      color: inkColors[Math.floor(Math.random() * inkColors.length)],
      tendrils: Array.from({ length: tendrilCount }, () => ({
        angle: Math.random() * Math.PI * 2,
        length: 0.3 + Math.random() * 0.7,
        speed: 0.5 + Math.random() * 0.5,
        wobble: Math.random() * Math.PI * 2,
      })),
      age: 0,
      fadeStart: 0.6 + Math.random() * 0.2,
    };
  }, [darkMode]);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start with a few drops
    dropsRef.current = Array.from({ length: 3 }, () => createDrop(canvas));

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      // Add new drops periodically
      if (timeRef.current - lastDropTimeRef.current > 2.5 + Math.random() * 2) {
        if (dropsRef.current.length < 8) {
          dropsRef.current.push(createDrop(canvas));
        }
        lastDropTimeRef.current = timeRef.current;
      }

      dropsRef.current.forEach((drop) => {
        drop.age += 0.008;
        const progress = Math.min(drop.age, 1);
        drop.radius = drop.maxRadius * Math.sqrt(progress); // Slow expansion

        // Calculate opacity fade
        let currentOpacity = drop.opacity;
        if (progress > drop.fadeStart) {
          const fadeProgress = (progress - drop.fadeStart) / (1 - drop.fadeStart);
          currentOpacity *= 1 - fadeProgress;
        }

        const { r, g, b } = drop.color;

        // Draw main ink blob with soft edges
        const gradient = ctx.createRadialGradient(
          drop.x, drop.y, 0,
          drop.x, drop.y, drop.radius
        );
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${currentOpacity * opacityMultiplier})`);
        gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${currentOpacity * 0.6 * opacityMultiplier})`);
        gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, ${currentOpacity * 0.3 * opacityMultiplier})`);
        gradient.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw tendrils extending outward
        drop.tendrils.forEach((tendril) => {
          const tendrilLength = drop.radius * tendril.length * progress;
          const wobbleOffset = Math.sin(timeRef.current * tendril.speed + tendril.wobble) * 10;

          const endX = drop.x + Math.cos(tendril.angle) * tendrilLength + Math.cos(tendril.angle + Math.PI / 2) * wobbleOffset;
          const endY = drop.y + Math.sin(tendril.angle) * tendrilLength + Math.sin(tendril.angle + Math.PI / 2) * wobbleOffset;

          const tendrilGradient = ctx.createLinearGradient(drop.x, drop.y, endX, endY);
          tendrilGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${currentOpacity * 0.5 * opacityMultiplier})`);
          tendrilGradient.addColorStop(1, 'transparent');

          ctx.beginPath();
          ctx.moveTo(drop.x, drop.y);
          ctx.quadraticCurveTo(
            (drop.x + endX) / 2 + wobbleOffset,
            (drop.y + endY) / 2 + wobbleOffset,
            endX,
            endY
          );
          ctx.strokeStyle = tendrilGradient;
          ctx.lineWidth = 3 + Math.random() * 2;
          ctx.lineCap = 'round';
          ctx.stroke();
        });
      });

      // Remove fully faded drops
      dropsRef.current = dropsRef.current.filter(drop => drop.age < 1);

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, active, createDrop]);
}

// ============================================================================
// RIPPLING WATER ANIMATION
// ============================================================================

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  speed: number;
}

function useRipplingWater(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const ripplesRef = useRef<Ripple[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);
  const lastRippleTimeRef = useRef<number>(0);

  const createRipple = useCallback((canvas: HTMLCanvasElement): Ripple => {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: 0,
      maxRadius: 80 + Math.random() * 120,
      opacity: 0.15 + Math.random() * 0.15,
      speed: 0.5 + Math.random() * 0.5,
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start with a few ripples
    ripplesRef.current = Array.from({ length: 3 }, () => {
      const ripple = createRipple(canvas);
      ripple.radius = Math.random() * ripple.maxRadius;
      return ripple;
    });

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      // Add new ripples periodically
      if (timeRef.current - lastRippleTimeRef.current > 1 + Math.random() * 2) {
        if (ripplesRef.current.length < 8) {
          ripplesRef.current.push(createRipple(canvas));
        }
        lastRippleTimeRef.current = timeRef.current;
      }

      // Update and draw ripples
      ripplesRef.current = ripplesRef.current.filter((ripple) => {
        ripple.radius += ripple.speed;

        const fadeRatio = 1 - ripple.radius / ripple.maxRadius;
        const alpha = ripple.opacity * fadeRatio * opacityMultiplier;

        if (alpha < 0.01) return false;

        // Draw concentric rings
        const ringColor = darkMode
          ? { r: 150, g: 200, b: 255 }
          : { r: 100, g: 150, b: 200 };

        for (let ring = 0; ring < 3; ring++) {
          const ringRadius = ripple.radius - ring * 8;
          if (ringRadius > 0) {
            ctx.beginPath();
            ctx.arc(ripple.x, ripple.y, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${ringColor.r}, ${ringColor.g}, ${ringColor.b}, ${alpha * (1 - ring * 0.3)})`;
            ctx.lineWidth = 1.5 - ring * 0.4;
            ctx.stroke();
          }
        }

        return true;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createRipple, active]);
}

// ============================================================================
// FALLING LEAVES ANIMATION
// ============================================================================

interface Leaf {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  fallSpeed: number;
  swayAmplitude: number;
  swaySpeed: number;
  swayPhase: number;
  opacity: number;
  variant: number; // 0 = maple, 1 = oak, 2 = simple
  color: { r: number; g: number; b: number };
}

function useFallingLeaves(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const leavesRef = useRef<Leaf[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const leafColors = [
    { r: 200, g: 80, b: 40 },    // Burnt orange
    { r: 220, g: 140, b: 30 },   // Golden yellow
    { r: 180, g: 60, b: 50 },    // Deep red
    { r: 190, g: 120, b: 40 },   // Amber
    { r: 160, g: 90, b: 60 },    // Brown
  ];

  const createLeaf = useCallback((canvas: HTMLCanvasElement, startFromTop = true): Leaf => {
    return {
      x: Math.random() * canvas.width,
      y: startFromTop ? -30 : Math.random() * canvas.height,
      size: 12 + Math.random() * 18,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.04,
      fallSpeed: 0.4 + Math.random() * 0.6,
      swayAmplitude: 40 + Math.random() * 60,
      swaySpeed: 0.3 + Math.random() * 0.5,
      swayPhase: Math.random() * Math.PI * 2,
      opacity: 0.4 + Math.random() * 0.4,
      variant: Math.floor(Math.random() * 3),
      color: leafColors[Math.floor(Math.random() * leafColors.length)],
    };
  }, [leafColors]);

  const drawLeaf = useCallback((
    ctx: CanvasRenderingContext2D,
    leaf: Leaf,
    opacityMultiplier: number
  ) => {
    ctx.save();
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(leaf.rotation);

    const s = leaf.size;
    const alpha = leaf.opacity * opacityMultiplier;
    const { r, g, b } = leaf.color;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;

    switch (leaf.variant) {
      case 0: // Maple-like leaf
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
          const outerR = s * 0.8;
          const innerR = s * 0.35;

          const outerX = Math.cos(angle) * outerR;
          const outerY = Math.sin(angle) * outerR;
          const innerAngle = angle + Math.PI / 5;
          const innerX = Math.cos(innerAngle) * innerR;
          const innerY = Math.sin(innerAngle) * innerR;

          if (i === 0) {
            ctx.moveTo(outerX, outerY);
          } else {
            ctx.lineTo(outerX, outerY);
          }
          ctx.lineTo(innerX, innerY);
        }
        ctx.closePath();
        ctx.fill();
        break;

      case 1: // Oak-like leaf (rounded lobes)
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.6);
        ctx.bezierCurveTo(s * 0.4, -s * 0.5, s * 0.5, -s * 0.2, s * 0.3, 0);
        ctx.bezierCurveTo(s * 0.5, s * 0.2, s * 0.4, s * 0.5, 0, s * 0.6);
        ctx.bezierCurveTo(-s * 0.4, s * 0.5, -s * 0.5, s * 0.2, -s * 0.3, 0);
        ctx.bezierCurveTo(-s * 0.5, -s * 0.2, -s * 0.4, -s * 0.5, 0, -s * 0.6);
        ctx.fill();
        break;

      case 2: // Simple oval leaf
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.35, s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        // Stem/vein
        ctx.strokeStyle = `rgba(${r - 30}, ${g - 30}, ${b - 10}, ${alpha * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.5);
        ctx.lineTo(0, s * 0.5);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const leafCount = Math.floor((canvas.width * canvas.height) / 30000);
    leavesRef.current = Array.from({ length: Math.max(12, leafCount) }, () =>
      createLeaf(canvas, false)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      leavesRef.current.forEach((leaf, index) => {
        // Falling motion
        leaf.y += leaf.fallSpeed;

        // Swaying motion
        const sway = Math.sin(timeRef.current * leaf.swaySpeed + leaf.swayPhase);
        leaf.x += sway * 0.5;

        // Rotation
        leaf.rotation += leaf.rotationSpeed + sway * 0.01;

        // Reset if off screen
        if (leaf.y > canvas.height + 50 || leaf.x < -50 || leaf.x > canvas.width + 50) {
          leavesRef.current[index] = createLeaf(canvas, true);
        }

        drawLeaf(ctx, leaf, opacityMultiplier);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createLeaf, drawLeaf, active]);
}

// ============================================================================
// EMBERS RISING ANIMATION
// ============================================================================

interface Ember {
  x: number;
  y: number;
  size: number;
  speed: number;
  wobblePhase: number;
  wobbleSpeed: number;
  opacity: number;
  fadeSpeed: number;
  glowSize: number;
}

function useEmbersRising(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const embersRef = useRef<Ember[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createEmber = useCallback((canvas: HTMLCanvasElement, startFromBottom = true): Ember => {
    return {
      x: Math.random() * canvas.width,
      y: startFromBottom ? canvas.height + 10 : Math.random() * canvas.height,
      size: 1.5 + Math.random() * 3,
      speed: 0.4 + Math.random() * 0.8,
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 1 + Math.random() * 2,
      opacity: 0.5 + Math.random() * 0.4,
      fadeSpeed: 0.002 + Math.random() * 0.003,
      glowSize: 8 + Math.random() * 12,
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const emberCount = Math.floor((canvas.width * canvas.height) / 25000);
    embersRef.current = Array.from({ length: Math.max(20, emberCount) }, () =>
      createEmber(canvas, false)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      embersRef.current.forEach((ember, index) => {
        // Rise upward
        ember.y -= ember.speed;

        // Wobble side to side
        ember.x += Math.sin(timeRef.current * ember.wobbleSpeed + ember.wobblePhase) * 0.4;

        // Fade out gradually
        ember.opacity -= ember.fadeSpeed;

        // Reset if faded or off screen
        if (ember.opacity <= 0 || ember.y < -20) {
          embersRef.current[index] = createEmber(canvas, true);
          return;
        }

        const alpha = ember.opacity * opacityMultiplier;

        // Ember colors: orange to red
        const colorShift = Math.sin(timeRef.current * 3 + ember.wobblePhase) * 0.5 + 0.5;
        const emberColor = {
          r: 255,
          g: Math.floor(100 + colorShift * 80),
          b: Math.floor(20 + colorShift * 30),
        };

        // Outer glow
        const gradient = ctx.createRadialGradient(
          ember.x, ember.y, 0,
          ember.x, ember.y, ember.glowSize
        );
        gradient.addColorStop(0, `rgba(${emberColor.r}, ${emberColor.g}, ${emberColor.b}, ${alpha * 0.4})`);
        gradient.addColorStop(0.3, `rgba(${emberColor.r}, ${emberColor.g - 30}, ${emberColor.b}, ${alpha * 0.2})`);
        gradient.addColorStop(1, `rgba(${emberColor.r}, ${emberColor.g - 50}, ${emberColor.b}, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(ember.x, ember.y, ember.glowSize, 0, Math.PI * 2);
        ctx.fill();

        // Bright core
        ctx.fillStyle = `rgba(255, 220, 150, ${alpha})`;
        ctx.beginPath();
        ctx.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2);
        ctx.fill();
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, createEmber, active]);
}

// ============================================================================
// GENTLE RAIN ANIMATION
// ============================================================================

interface GentleRainDrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  thickness: number;
}

interface GentleRainSplash {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
}

function useGentleRain(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const dropsRef = useRef<GentleRainDrop[]>([]);
  const splashesRef = useRef<GentleRainSplash[]>([]);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Create initial raindrops
    const dropCount = Math.floor((canvas.width * canvas.height) / 15000);
    dropsRef.current = Array.from({ length: dropCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      length: 15 + Math.random() * 25,
      speed: 4 + Math.random() * 4,
      opacity: 0.1 + Math.random() * 0.15,
      thickness: 1 + Math.random() * 1.5,
    }));

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const opacityMultiplier = opacity / 50;
      const rainColor = darkMode
        ? { r: 180, g: 200, b: 220 }
        : { r: 100, g: 130, b: 160 };

      // Draw and update raindrops
      dropsRef.current.forEach((drop) => {
        // Draw the raindrop as a diagonal line
        const angle = Math.PI / 12; // Slight diagonal
        const endX = drop.x + Math.sin(angle) * drop.length;
        const endY = drop.y + Math.cos(angle) * drop.length;

        const gradient = ctx.createLinearGradient(drop.x, drop.y, endX, endY);
        gradient.addColorStop(0, 'transparent');
        gradient.addColorStop(0.3, `rgba(${rainColor.r}, ${rainColor.g}, ${rainColor.b}, ${drop.opacity * opacityMultiplier})`);
        gradient.addColorStop(1, `rgba(${rainColor.r}, ${rainColor.g}, ${rainColor.b}, ${drop.opacity * 0.5 * opacityMultiplier})`);

        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = drop.thickness;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Move the drop
        drop.y += drop.speed;
        drop.x += drop.speed * Math.sin(angle);

        // Reset drop and create splash when it hits bottom
        if (drop.y > canvas.height) {
          // Create splash effect
          if (Math.random() < 0.3) {
            splashesRef.current.push({
              x: drop.x,
              y: canvas.height - 5,
              radius: 0,
              maxRadius: 8 + Math.random() * 8,
              opacity: 0.2 + Math.random() * 0.1,
            });
          }

          // Reset drop to top
          drop.y = -drop.length;
          drop.x = Math.random() * canvas.width;
        }
      });

      // Draw and update splashes
      splashesRef.current.forEach((splash) => {
        splash.radius += 0.8;
        const progress = splash.radius / splash.maxRadius;
        const currentOpacity = splash.opacity * (1 - progress) * opacityMultiplier;

        if (currentOpacity > 0.01) {
          ctx.beginPath();
          ctx.arc(splash.x, splash.y, splash.radius, 0, Math.PI);
          ctx.strokeStyle = `rgba(${rainColor.r}, ${rainColor.g}, ${rainColor.b}, ${currentOpacity})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });

      // Remove completed splashes
      splashesRef.current = splashesRef.current.filter(
        splash => splash.radius < splash.maxRadius
      );

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, active]);
}

// ============================================================================
// NORTHERN LIGHTS ANIMATION
// ============================================================================

interface AuroraBand {
  y: number;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
  color: { r: number; g: number; b: number };
  height: number;
}

function useNorthernLights(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const bandsRef = useRef<AuroraBand[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Aurora colors - greens, teals, purples, pinks
    const auroraColors = [
      { r: 80, g: 200, b: 120 },   // Green
      { r: 50, g: 180, b: 160 },   // Teal
      { r: 100, g: 150, b: 200 },  // Light blue
      { r: 150, g: 100, b: 180 },  // Purple
      { r: 180, g: 100, b: 150 },  // Pink
    ];

    // Create flowing aurora bands
    const bandCount = 4;
    bandsRef.current = Array.from({ length: bandCount }, (_, i) => ({
      y: canvas.height * 0.2 + (canvas.height * 0.4 / bandCount) * i,
      amplitude: 30 + Math.random() * 50,
      frequency: 0.002 + Math.random() * 0.003,
      speed: 0.2 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      color: auroraColors[i % auroraColors.length],
      height: 80 + Math.random() * 60,
    }));

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = (opacity / 50) * (darkMode ? 1 : 0.6);

      bandsRef.current.forEach((band, bandIndex) => {
        // Draw flowing curtain effect
        ctx.beginPath();

        const points: { x: number; y: number }[] = [];

        // Calculate wave points
        for (let x = 0; x <= canvas.width; x += 8) {
          const wave1 = Math.sin(x * band.frequency + timeRef.current * band.speed + band.phase) * band.amplitude;
          const wave2 = Math.sin(x * band.frequency * 1.5 + timeRef.current * band.speed * 0.7 + band.phase * 2) * (band.amplitude * 0.5);
          const y = band.y + wave1 + wave2;
          points.push({ x, y });
        }

        // Draw top edge
        ctx.moveTo(0, points[0].y);
        points.forEach(point => ctx.lineTo(point.x, point.y));

        // Draw bottom edge (with offset for band height)
        for (let i = points.length - 1; i >= 0; i--) {
          const heightVariation = Math.sin(points[i].x * 0.01 + timeRef.current * 0.5) * 20;
          ctx.lineTo(points[i].x, points[i].y + band.height + heightVariation);
        }

        ctx.closePath();

        // Create vertical gradient for aurora glow effect
        const gradient = ctx.createLinearGradient(0, band.y - band.amplitude, 0, band.y + band.height + band.amplitude);
        const { r, g, b } = band.color;
        const baseOpacity = 0.06 + bandIndex * 0.01;

        gradient.addColorStop(0, 'transparent');
        gradient.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, ${baseOpacity * opacityMultiplier})`);
        gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${(baseOpacity + 0.04) * opacityMultiplier})`);
        gradient.addColorStop(0.8, `rgba(${r}, ${g}, ${b}, ${baseOpacity * opacityMultiplier})`);
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.fill();

        // Add subtle shimmer lines within the band
        for (let i = 0; i < points.length - 1; i += 3) {
          const shimmerOpacity = (Math.sin(timeRef.current * 2 + i * 0.5) * 0.5 + 0.5) * 0.03 * opacityMultiplier;
          if (shimmerOpacity > 0.01) {
            ctx.beginPath();
            ctx.moveTo(points[i].x, points[i].y);
            ctx.lineTo(points[i].x, points[i].y + band.height * 0.8);
            ctx.strokeStyle = `rgba(255, 255, 255, ${shimmerOpacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, active]);
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

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
