/**
 * Butterfly Garden Animation (replaces triangles)
 *
 * Colorful butterflies fluttering among flowers in a meadow.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface Butterfly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  wingPhase: number;
  hue: number;
  pattern: number;
  targetX: number;
  targetY: number;
}

interface Flower {
  x: number;
  y: number;
  size: number;
  petalCount: number;
  hue: number;
  swayPhase: number;
  stemHeight: number;
}

export function useButterflyGarden(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const butterfliesRef = useRef<Butterfly[]>([]);
  const flowersRef = useRef<Flower[]>([]);
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

      // Create flowers
      flowersRef.current = [];
      const flowerCount = Math.floor(width / 60);
      for (let i = 0; i < flowerCount; i++) {
        flowersRef.current.push({
          x: (i / flowerCount) * width + (Math.random() - 0.5) * 50,
          y: height * 0.6 + Math.random() * height * 0.35,
          size: 15 + Math.random() * 20,
          petalCount: 5 + Math.floor(Math.random() * 3),
          hue: [320, 40, 280, 200, 350][Math.floor(Math.random() * 5)],
          swayPhase: Math.random() * Math.PI * 2,
          stemHeight: 40 + Math.random() * 60,
        });
      }

      // Create butterflies
      butterfliesRef.current = [];
      for (let i = 0; i < 8; i++) {
        butterfliesRef.current.push({
          x: Math.random() * width,
          y: height * 0.2 + Math.random() * height * 0.5,
          vx: 0,
          vy: 0,
          size: 12 + Math.random() * 10,
          wingPhase: Math.random() * Math.PI * 2,
          hue: [280, 30, 180, 320, 50][Math.floor(Math.random() * 5)],
          pattern: Math.floor(Math.random() * 3),
          targetX: Math.random() * width,
          targetY: height * 0.2 + Math.random() * height * 0.5,
        });
      }
    };

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      if (darkMode) {
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.6, '#2a2a3e');
        gradient.addColorStop(1, '#1a2a1a');
      } else {
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(0.6, '#98D8C8');
        gradient.addColorStop(1, '#7CB342');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawFlower = (flower: Flower, time: number) => {
      const sway = Math.sin(time * 0.001 + flower.swayPhase) * 3;

      ctx.save();
      ctx.translate(flower.x + sway, flower.y);

      // Stem
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sway * 2, -flower.stemHeight / 2, sway, -flower.stemHeight);
      ctx.strokeStyle = darkMode ? '#2a4a2a' : '#4CAF50';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Flower head
      ctx.translate(sway, -flower.stemHeight);

      // Petals
      for (let p = 0; p < flower.petalCount; p++) {
        const angle = (p / flower.petalCount) * Math.PI * 2;
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(0, -flower.size * 0.6, flower.size * 0.35, flower.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = darkMode
          ? `hsla(${flower.hue}, 40%, 40%, 0.8)`
          : `hsla(${flower.hue}, 70%, 70%, 0.9)`;
        ctx.fill();
        ctx.restore();
      }

      // Center
      ctx.beginPath();
      ctx.arc(0, 0, flower.size * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = darkMode ? '#aa8800' : '#FFD700';
      ctx.fill();

      ctx.restore();
    };

    const drawButterfly = (butterfly: Butterfly, time: number) => {
      // Update movement
      const dx = butterfly.targetX - butterfly.x;
      const dy = butterfly.targetY - butterfly.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 30) {
        butterfly.targetX = Math.random() * canvas.width;
        butterfly.targetY = canvas.height * 0.2 + Math.random() * canvas.height * 0.5;
      }

      butterfly.vx += dx * 0.0003;
      butterfly.vy += dy * 0.0003;
      butterfly.vx *= 0.98;
      butterfly.vy *= 0.98;
      butterfly.x += butterfly.vx;
      butterfly.y += butterfly.vy + Math.sin(time * 0.003 + butterfly.wingPhase) * 0.3;

      butterfly.wingPhase += 0.12;

      ctx.save();
      ctx.translate(butterfly.x, butterfly.y);

      const wingFlap = Math.sin(butterfly.wingPhase) * 0.7;
      const size = butterfly.size;

      // Wings
      const wingColor = darkMode
        ? `hsl(${butterfly.hue}, 50%, 45%)`
        : `hsl(${butterfly.hue}, 70%, 60%)`;

      // Left wing
      ctx.save();
      ctx.scale(1, Math.cos(wingFlap));
      ctx.beginPath();
      ctx.ellipse(-size * 0.5, 0, size * 0.8, size * 0.5, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = wingColor;
      ctx.fill();
      // Wing pattern
      if (butterfly.pattern === 0) {
        ctx.beginPath();
        ctx.arc(-size * 0.5, -size * 0.1, size * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
      }
      ctx.restore();

      // Right wing
      ctx.save();
      ctx.scale(1, Math.cos(wingFlap));
      ctx.beginPath();
      ctx.ellipse(size * 0.5, 0, size * 0.8, size * 0.5, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = wingColor;
      ctx.fill();
      if (butterfly.pattern === 0) {
        ctx.beginPath();
        ctx.arc(size * 0.5, -size * 0.1, size * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
      }
      ctx.restore();

      // Body
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.1, size * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = darkMode ? '#2a2a2a' : '#333';
      ctx.fill();

      // Antennae
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.3);
      ctx.quadraticCurveTo(-size * 0.2, -size * 0.6, -size * 0.15, -size * 0.7);
      ctx.moveTo(0, -size * 0.3);
      ctx.quadraticCurveTo(size * 0.2, -size * 0.6, size * 0.15, -size * 0.7);
      ctx.strokeStyle = darkMode ? '#3a3a3a' : '#444';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();

      // Draw flowers (sorted by y for depth)
      const sortedFlowers = [...flowersRef.current].sort((a, b) => a.y - b.y);
      sortedFlowers.forEach((flower) => drawFlower(flower, time));

      // Draw butterflies
      butterfliesRef.current.forEach((butterfly) => drawButterfly(butterfly, time));

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
