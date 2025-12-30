/**
 * Autumn Wind Animation
 * Swirling gusts with occasional leaf bursts.
 * Wind streams carry fallen leaves in dynamic patterns.
 */

import { useEffect, useRef } from 'react';

interface Leaf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  type: 'maple' | 'oak' | 'round';
  color: { r: number; g: number; b: number };
  opacity: number;
  tumble: number;
  tumbleSpeed: number;
  windInfluence: number;
}

interface WindGust {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strength: number;
  lifetime: number;
  maxLifetime: number;
  particles: WindParticle[];
}

interface WindParticle {
  x: number;
  y: number;
  opacity: number;
  size: number;
}

export function useAutumnWind(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const leavesRef = useRef<Leaf[]>([]);
  const gustsRef = useRef<WindGust[]>([]);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const baseWindRef = useRef<{ x: number; y: number }>({ x: 1.5, y: 0.2 });

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const autumnColors = [
      { r: 220, g: 80, b: 40 },   // Red-orange
      { r: 240, g: 140, b: 40 },  // Orange
      { r: 200, g: 160, b: 50 },  // Golden yellow
      { r: 180, g: 60, b: 30 },   // Deep red
      { r: 160, g: 100, b: 40 },  // Brown
      { r: 230, g: 180, b: 60 },  // Bright yellow
      { r: 190, g: 50, b: 50 },   // Crimson
    ];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initializeLeaves();
    };

    const initializeLeaves = () => {
      leavesRef.current = [];
      const leafCount = Math.floor((canvas.width * canvas.height) / 20000);

      for (let i = 0; i < leafCount; i++) {
        leavesRef.current.push(createLeaf(true));
      }
    };

    const createLeaf = (randomPos = false): Leaf => {
      const types: ('maple' | 'oak' | 'round')[] = ['maple', 'oak', 'round'];
      const type = types[Math.floor(Math.random() * types.length)];
      const color = autumnColors[Math.floor(Math.random() * autumnColors.length)];

      return {
        x: randomPos ? Math.random() * canvas.width : -30,
        y: randomPos ? Math.random() * canvas.height : Math.random() * canvas.height * 0.5,
        vx: 0.5 + Math.random() * 1,
        vy: 0.2 + Math.random() * 0.5,
        size: 12 + Math.random() * 18,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.08,
        type,
        color,
        opacity: 0.6 + Math.random() * 0.3,
        tumble: Math.random() * Math.PI * 2,
        tumbleSpeed: 0.03 + Math.random() * 0.05,
        windInfluence: 0.5 + Math.random() * 0.5,
      };
    };

    const createGust = (): WindGust => {
      const particles: WindParticle[] = [];
      const particleCount = 20 + Math.floor(Math.random() * 30);

      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random(),
          y: Math.random(),
          opacity: 0.1 + Math.random() * 0.2,
          size: 2 + Math.random() * 3,
        });
      }

      return {
        x: -200,
        y: Math.random() * canvas.height,
        width: 300 + Math.random() * 200,
        height: 100 + Math.random() * 150,
        angle: (Math.random() - 0.5) * 0.3,
        strength: 3 + Math.random() * 4,
        lifetime: 0,
        maxLifetime: 200 + Math.random() * 100,
        particles,
      };
    };

    const drawMapleLeaf = (ctx: CanvasRenderingContext2D, size: number) => {
      const s = size * 0.5;

      ctx.beginPath();
      ctx.moveTo(0, -s * 1.2);

      // Right side lobes
      ctx.quadraticCurveTo(s * 0.3, -s * 0.9, s * 0.8, -s * 0.8);
      ctx.quadraticCurveTo(s * 0.5, -s * 0.5, s * 1.1, -s * 0.2);
      ctx.quadraticCurveTo(s * 0.6, -s * 0.1, s * 0.9, s * 0.4);
      ctx.quadraticCurveTo(s * 0.4, s * 0.3, s * 0.5, s * 0.8);
      ctx.quadraticCurveTo(s * 0.2, s * 0.5, 0, s * 1.0);

      // Left side lobes (mirror)
      ctx.quadraticCurveTo(-s * 0.2, s * 0.5, -s * 0.5, s * 0.8);
      ctx.quadraticCurveTo(-s * 0.4, s * 0.3, -s * 0.9, s * 0.4);
      ctx.quadraticCurveTo(-s * 0.6, -s * 0.1, -s * 1.1, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.5, -s * 0.5, -s * 0.8, -s * 0.8);
      ctx.quadraticCurveTo(-s * 0.3, -s * 0.9, 0, -s * 1.2);

      ctx.closePath();
    };

    const drawOakLeaf = (ctx: CanvasRenderingContext2D, size: number) => {
      const s = size * 0.5;

      ctx.beginPath();
      ctx.moveTo(0, -s * 1.1);

      // Right side with rounded lobes
      for (let i = 0; i < 4; i++) {
        const y = -s * 0.9 + (i * s * 0.5);
        const x = s * (0.5 + Math.sin(i * 0.8) * 0.3);
        ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.1, x, y + s * 0.25);
        ctx.quadraticCurveTo(x - s * 0.1, y + s * 0.35, s * 0.3, y + s * 0.45);
      }

      ctx.lineTo(0, s * 1.0);

      // Left side (mirror)
      for (let i = 3; i >= 0; i--) {
        const y = -s * 0.9 + (i * s * 0.5);
        const x = -s * (0.5 + Math.sin(i * 0.8) * 0.3);
        ctx.quadraticCurveTo(-s * 0.3, y + s * 0.45, x + s * 0.1, y + s * 0.35);
        ctx.quadraticCurveTo(x, y + s * 0.25, x - s * 0.2, y + s * 0.1);
      }

      ctx.closePath();
    };

    const drawRoundLeaf = (ctx: CanvasRenderingContext2D, size: number) => {
      const s = size * 0.5;

      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.7, s * 1.0, 0, 0, Math.PI * 2);
      ctx.closePath();
    };

    const drawLeaf = (leaf: Leaf, opacityMult: number) => {
      ctx.save();
      ctx.translate(leaf.x, leaf.y);
      ctx.rotate(leaf.rotation);

      // 3D tumble effect
      const tumbleFactor = Math.cos(leaf.tumble);
      ctx.scale(0.3 + Math.abs(tumbleFactor) * 0.7, 1);

      const alpha = leaf.opacity * opacityMult;
      const { r, g, b } = leaf.color;

      // Draw leaf shape based on type
      switch (leaf.type) {
        case 'maple':
          drawMapleLeaf(ctx, leaf.size);
          break;
        case 'oak':
          drawOakLeaf(ctx, leaf.size);
          break;
        case 'round':
          drawRoundLeaf(ctx, leaf.size);
          break;
      }

      // Fill with gradient
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, leaf.size);
      gradient.addColorStop(0, `rgba(${r + 30}, ${g + 30}, ${b + 20}, ${alpha})`);
      gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      gradient.addColorStop(1, `rgba(${r - 30}, ${g - 30}, ${b - 20}, ${alpha * 0.8})`);

      ctx.fillStyle = gradient;
      ctx.fill();

      // Central vein
      ctx.strokeStyle = `rgba(${r - 60}, ${g - 50}, ${b - 30}, ${alpha * 0.4})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, -leaf.size * 0.4);
      ctx.lineTo(0, leaf.size * 0.4);
      ctx.stroke();

      ctx.restore();
    };

    const drawGust = (gust: WindGust, opacityMult: number) => {
      const progress = gust.lifetime / gust.maxLifetime;
      const fadeIn = Math.min(1, progress * 5);
      const fadeOut = Math.max(0, 1 - (progress - 0.7) * 3.33);
      const gustOpacity = fadeIn * fadeOut;

      ctx.save();
      ctx.translate(gust.x, gust.y);
      ctx.rotate(gust.angle);

      // Draw wind particles
      gust.particles.forEach((particle) => {
        const px = particle.x * gust.width;
        const py = (particle.y - 0.5) * gust.height;
        const alpha = particle.opacity * gustOpacity * opacityMult;

        const windColor = darkMode
          ? `rgba(200, 200, 220, ${alpha})`
          : `rgba(180, 180, 200, ${alpha})`;

        ctx.fillStyle = windColor;
        ctx.beginPath();
        ctx.ellipse(px, py, particle.size * 3, particle.size, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      // Wind streak lines
      ctx.strokeStyle = darkMode
        ? `rgba(200, 200, 220, ${gustOpacity * 0.1 * opacityMult})`
        : `rgba(180, 180, 200, ${gustOpacity * 0.1 * opacityMult})`;
      ctx.lineWidth = 1;

      for (let i = 0; i < 5; i++) {
        const y = (i / 4 - 0.5) * gust.height * 0.8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(
          gust.width * 0.3, y + 10,
          gust.width * 0.6, y - 10,
          gust.width, y
        );
        ctx.stroke();
      }

      ctx.restore();
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const opacityMult = opacity / 50;

      // Vary base wind
      baseWindRef.current.x = 1.5 + Math.sin(time * 0.001) * 0.5;
      baseWindRef.current.y = 0.2 + Math.sin(time * 0.0015) * 0.3;

      // Spawn gusts occasionally
      if (Math.random() < 0.008) {
        gustsRef.current.push(createGust());
      }

      // Update and draw gusts
      gustsRef.current = gustsRef.current.filter((gust) => {
        gust.lifetime++;
        gust.x += gust.strength * 2;

        // Move particles within gust
        gust.particles.forEach((p) => {
          p.x += 0.01;
          if (p.x > 1) p.x = 0;
        });

        if (gust.lifetime > gust.maxLifetime || gust.x > canvas.width + gust.width) {
          return false;
        }

        drawGust(gust, opacityMult);
        return true;
      });

      // Update and draw leaves
      leavesRef.current.forEach((leaf, index) => {
        // Apply base wind
        leaf.vx += (baseWindRef.current.x - leaf.vx) * 0.02 * leaf.windInfluence;
        leaf.vy += (baseWindRef.current.y + 0.5 - leaf.vy) * 0.02;

        // Check if leaf is in a gust
        gustsRef.current.forEach((gust) => {
          const progress = gust.lifetime / gust.maxLifetime;
          const gustActive = progress > 0.1 && progress < 0.9;

          if (gustActive) {
            // Transform leaf position to gust space
            const dx = leaf.x - gust.x;
            const dy = leaf.y - gust.y;
            const rotatedX = dx * Math.cos(-gust.angle) - dy * Math.sin(-gust.angle);
            const rotatedY = dx * Math.sin(-gust.angle) + dy * Math.cos(-gust.angle);

            if (rotatedX > 0 && rotatedX < gust.width &&
                Math.abs(rotatedY) < gust.height / 2) {
              // Leaf is in gust - apply force
              leaf.vx += gust.strength * 0.3 * leaf.windInfluence;
              leaf.vy += Math.sin(gust.angle) * gust.strength * 0.1;
              leaf.rotationSpeed += (Math.random() - 0.5) * 0.02;
            }
          }
        });

        // Apply velocity
        leaf.x += leaf.vx;
        leaf.y += leaf.vy;

        // Update rotation and tumble
        leaf.rotation += leaf.rotationSpeed;
        leaf.tumble += leaf.tumbleSpeed;

        // Dampen rotation
        leaf.rotationSpeed *= 0.99;

        // Reset if off screen
        if (leaf.x > canvas.width + 50 || leaf.y > canvas.height + 50) {
          leavesRef.current[index] = createLeaf(false);
        }

        drawLeaf(leaf, opacityMult);
      });

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
