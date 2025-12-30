/**
 * Wisteria Arbor Animation
 *
 * Cascading wisteria flowers hanging from an arbor with gentle swaying.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface WisteriaCluster {
  x: number;
  y: number;
  length: number;
  phase: number;
  swayAmount: number;
  flowers: { offset: number; size: number; hue: number; saturation: number }[];
}

interface FallingPetal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  hue: number;
  opacity: number;
}

export function useWisteriaArbor(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const clustersRef = useRef<WisteriaCluster[]>([]);
  const petalsRef = useRef<FallingPetal[]>([]);
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

      // Create wisteria clusters hanging from top
      clustersRef.current = [];
      const clusterCount = Math.floor(width / 40);

      for (let i = 0; i < clusterCount; i++) {
        const x = (i / clusterCount) * width + (Math.random() - 0.5) * 30;
        const length = 100 + Math.random() * 200;
        const flowerCount = 8 + Math.floor(Math.random() * 12);

        const flowers: { offset: number; size: number; hue: number; saturation: number }[] = [];
        for (let f = 0; f < flowerCount; f++) {
          const progress = f / flowerCount;
          flowers.push({
            offset: progress * length,
            size: 4 + (1 - progress) * 6 + Math.random() * 3, // Larger at top
            hue: 270 + Math.random() * 30 - 15, // Purple to lavender
            saturation: 50 + Math.random() * 30,
          });
        }

        clustersRef.current.push({
          x,
          y: -10 + Math.random() * 30,
          length,
          phase: Math.random() * Math.PI * 2,
          swayAmount: 15 + Math.random() * 15,
          flowers,
        });
      }

      // Initialize falling petals
      petalsRef.current = [];
      for (let i = 0; i < 15; i++) {
        petalsRef.current.push(createPetal(width, height));
      }
    };

    const createPetal = (width: number, height: number): FallingPetal => ({
      x: Math.random() * width,
      y: -20 - Math.random() * 100,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 0.3 + Math.random() * 0.3,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.02,
      size: 3 + Math.random() * 3,
      hue: 270 + Math.random() * 30 - 15,
      opacity: 0.6 + Math.random() * 0.4,
    });

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      if (darkMode) {
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#2d2d44');
      } else {
        gradient.addColorStop(0, '#E8E0F0');
        gradient.addColorStop(0.5, '#F0E8F8');
        gradient.addColorStop(1, '#F8F0FF');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawArbor = () => {
      const width = canvas.width;

      // Draw wooden arbor beams
      ctx.fillStyle = darkMode ? '#3a2a1a' : '#8B4513';

      // Top horizontal beam
      ctx.fillRect(0, 0, width, 15);

      // Lattice pattern
      ctx.strokeStyle = darkMode ? '#2a1a0a' : '#654321';
      ctx.lineWidth = 3;

      for (let x = 0; x < width; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 80);
        ctx.stroke();
      }

      // Cross beams
      for (let y = 20; y < 80; y += 25) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    };

    const drawWisteria = (time: number) => {
      clustersRef.current.forEach((cluster) => {
        const sway = Math.sin(time * 0.0008 + cluster.phase) * cluster.swayAmount;
        const secondarySway = Math.sin(time * 0.0015 + cluster.phase * 2) * cluster.swayAmount * 0.3;

        // Draw stem
        ctx.beginPath();
        ctx.moveTo(cluster.x, cluster.y);

        // Create curved vine using quadratic bezier
        const midX = cluster.x + sway * 0.5;
        const midY = cluster.y + cluster.length * 0.5;
        const endX = cluster.x + sway + secondarySway;
        const endY = cluster.y + cluster.length;

        ctx.quadraticCurveTo(midX, midY, endX, endY);
        ctx.strokeStyle = darkMode ? '#2a3a2a' : '#556B2F';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw flowers along the vine
        cluster.flowers.forEach((flower) => {
          const t = flower.offset / cluster.length;
          // Calculate position along bezier curve
          const oneMinusT = 1 - t;
          const fx =
            oneMinusT * oneMinusT * cluster.x +
            2 * oneMinusT * t * midX +
            t * t * endX;
          const fy =
            oneMinusT * oneMinusT * cluster.y +
            2 * oneMinusT * t * midY +
            t * t * endY;

          // Draw flower cluster (multiple small circles)
          const flowerSway = Math.sin(time * 0.001 + cluster.phase + t * 3) * 3;

          for (let p = 0; p < 4; p++) {
            const angle = (p / 4) * Math.PI * 2 + time * 0.0003;
            const px = fx + Math.cos(angle) * flower.size * 0.5 + flowerSway;
            const py = fy + Math.sin(angle) * flower.size * 0.3;

            ctx.beginPath();
            ctx.arc(px, py, flower.size * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = darkMode
              ? `hsla(${flower.hue}, ${flower.saturation}%, 40%, 0.8)`
              : `hsla(${flower.hue}, ${flower.saturation}%, 70%, 0.9)`;
            ctx.fill();
          }

          // Center of flower
          ctx.beginPath();
          ctx.arc(fx + flowerSway, fy, flower.size * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = darkMode
            ? `hsla(${flower.hue + 10}, ${flower.saturation + 10}%, 50%, 0.9)`
            : `hsla(${flower.hue + 10}, ${flower.saturation + 10}%, 80%, 1)`;
          ctx.fill();
        });
      });
    };

    const drawFallingPetals = () => {
      const width = canvas.width;
      const height = canvas.height;

      petalsRef.current.forEach((petal, index) => {
        // Update position
        petal.x += petal.vx + Math.sin(timeRef.current * 0.002 + petal.rotation) * 0.3;
        petal.y += petal.vy;
        petal.rotation += petal.rotationSpeed;

        // Reset if off screen
        if (petal.y > height + 20) {
          petalsRef.current[index] = createPetal(width, height);
          return;
        }

        // Draw petal
        ctx.save();
        ctx.translate(petal.x, petal.y);
        ctx.rotate(petal.rotation);

        ctx.beginPath();
        ctx.ellipse(0, 0, petal.size, petal.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = darkMode
          ? `hsla(${petal.hue}, 50%, 45%, ${petal.opacity * 0.7})`
          : `hsla(${petal.hue}, 70%, 75%, ${petal.opacity})`;
        ctx.fill();

        ctx.restore();
      });
    };

    const animate = () => {
      timeRef.current += 16;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();
      drawArbor();
      drawWisteria(timeRef.current);
      drawFallingPetals();

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
