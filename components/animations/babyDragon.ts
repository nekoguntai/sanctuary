/**
 * Baby Dragon Animation
 *
 * A cute small dragon with shimmering scales curled up in a cozy nest.
 * Occasional sleepy puffs of smoke and gentle breathing.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface DragonScale {
  x: number;
  y: number;
  size: number;
  shimmerPhase: number;
}

interface SmokePuff {
  x: number;
  y: number;
  size: number;
  opacity: number;
  vx: number;
  vy: number;
}

interface Ember {
  x: number;
  y: number;
  size: number;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  hue: number;
}

interface Treasure {
  x: number;
  y: number;
  size: number;
  type: 'coin' | 'gem' | 'ring';
  hue: number;
  shimmerPhase: number;
}

export function useBabyDragon(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const scalesRef = useRef<DragonScale[]>([]);
  const smokePuffsRef = useRef<SmokePuff[]>([]);
  const embersRef = useRef<Ember[]>([]);
  const treasuresRef = useRef<Treasure[]>([]);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const nextSmokeRef = useRef<number>(0);

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

      // Dragon position (center-ish)
      const dragonX = width * 0.5;
      const dragonY = height * 0.6;
      const dragonSize = Math.min(width, height) * 0.15;

      // Generate scales for body
      scalesRef.current = [];
      for (let i = 0; i < 30; i++) {
        const angle = (i / 30) * Math.PI * 1.5 - Math.PI * 0.3;
        const radius = dragonSize * (0.6 + Math.random() * 0.3);
        scalesRef.current.push({
          x: dragonX + Math.cos(angle) * radius * 0.8,
          y: dragonY + Math.sin(angle) * radius * 0.5,
          size: 8 + Math.random() * 6,
          shimmerPhase: Math.random() * Math.PI * 2,
        });
      }

      // Generate treasure around the dragon
      treasuresRef.current = [];
      const treasureTypes: ('coin' | 'gem' | 'ring')[] = ['coin', 'gem', 'ring'];
      for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = dragonSize * 1.2 + Math.random() * dragonSize * 0.8;
        treasuresRef.current.push({
          x: dragonX + Math.cos(angle) * dist,
          y: dragonY + Math.sin(angle) * dist * 0.4 + dragonSize * 0.3,
          size: 8 + Math.random() * 8,
          type: treasureTypes[Math.floor(Math.random() * treasureTypes.length)],
          hue: Math.random() > 0.5 ? 45 : 280, // Gold or purple gem
          shimmerPhase: Math.random() * Math.PI * 2,
        });
      }

      // Initialize empty arrays
      smokePuffsRef.current = [];
      embersRef.current = [];
      nextSmokeRef.current = 2000 + Math.random() * 3000;
    };

    const drawBackground = () => {
      // Cave background
      const gradient = ctx.createRadialGradient(
        canvas.width * 0.5,
        canvas.height * 0.4,
        0,
        canvas.width * 0.5,
        canvas.height * 0.5,
        canvas.width * 0.8
      );

      if (darkMode) {
        gradient.addColorStop(0, '#2a2035');
        gradient.addColorStop(0.5, '#1a1525');
        gradient.addColorStop(1, '#0a0510');
      } else {
        gradient.addColorStop(0, '#4a3545');
        gradient.addColorStop(0.5, '#3a2535');
        gradient.addColorStop(1, '#2a1525');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Warm glow from dragon
      const glowGradient = ctx.createRadialGradient(
        canvas.width * 0.5,
        canvas.height * 0.6,
        0,
        canvas.width * 0.5,
        canvas.height * 0.6,
        canvas.width * 0.3
      );
      glowGradient.addColorStop(0, 'rgba(255, 100, 50, 0.15)');
      glowGradient.addColorStop(0.5, 'rgba(255, 80, 30, 0.05)');
      glowGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawNest = () => {
      const nestX = canvas.width * 0.5;
      const nestY = canvas.height * 0.65;
      const nestWidth = canvas.width * 0.25;
      const nestHeight = canvas.height * 0.08;

      // Nest base (twigs and straw)
      ctx.beginPath();
      ctx.ellipse(nestX, nestY, nestWidth, nestHeight, 0, 0, Math.PI * 2);
      const nestGradient = ctx.createRadialGradient(nestX, nestY, 0, nestX, nestY, nestWidth);
      nestGradient.addColorStop(0, '#5a4030');
      nestGradient.addColorStop(0.7, '#4a3020');
      nestGradient.addColorStop(1, '#3a2015');
      ctx.fillStyle = nestGradient;
      ctx.fill();

      // Nest texture (straw lines)
      ctx.strokeStyle = '#6a5040';
      ctx.lineWidth = 2;
      for (let i = 0; i < 20; i++) {
        const startAngle = Math.random() * Math.PI * 2;
        const length = 20 + Math.random() * 30;
        ctx.beginPath();
        ctx.moveTo(
          nestX + Math.cos(startAngle) * nestWidth * 0.8,
          nestY + Math.sin(startAngle) * nestHeight * 0.8
        );
        ctx.lineTo(
          nestX + Math.cos(startAngle + 0.2) * (nestWidth * 0.8 + length),
          nestY + Math.sin(startAngle + 0.2) * (nestHeight * 0.8 + length * 0.3)
        );
        ctx.stroke();
      }
    };

    const drawTreasure = (time: number) => {
      treasuresRef.current.forEach((treasure) => {
        const shimmer = Math.sin(time * 0.002 + treasure.shimmerPhase) * 0.3 + 0.7;

        ctx.save();
        ctx.translate(treasure.x, treasure.y);

        if (treasure.type === 'coin') {
          ctx.beginPath();
          ctx.ellipse(0, 0, treasure.size, treasure.size * 0.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${treasure.hue}, 70%, ${50 * shimmer}%, 0.9)`;
          ctx.fill();
          ctx.strokeStyle = `hsla(${treasure.hue}, 80%, ${60 * shimmer}%, 1)`;
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (treasure.type === 'gem') {
          ctx.beginPath();
          ctx.moveTo(0, -treasure.size);
          ctx.lineTo(treasure.size * 0.7, 0);
          ctx.lineTo(0, treasure.size * 0.6);
          ctx.lineTo(-treasure.size * 0.7, 0);
          ctx.closePath();
          ctx.fillStyle = `hsla(${treasure.hue}, 70%, ${45 * shimmer}%, 0.8)`;
          ctx.fill();
          // Highlight
          ctx.beginPath();
          ctx.moveTo(0, -treasure.size * 0.8);
          ctx.lineTo(treasure.size * 0.3, -treasure.size * 0.2);
          ctx.lineTo(0, 0);
          ctx.closePath();
          ctx.fillStyle = `hsla(${treasure.hue}, 60%, ${70 * shimmer}%, 0.5)`;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, treasure.size, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${treasure.hue}, 70%, ${50 * shimmer}%, 0.9)`;
          ctx.lineWidth = treasure.size * 0.3;
          ctx.stroke();
        }

        ctx.restore();
      });
    };

    const drawDragon = (time: number) => {
      const dragonX = canvas.width * 0.5;
      const dragonY = canvas.height * 0.6;
      const size = Math.min(canvas.width, canvas.height) * 0.15;
      const breathScale = 1 + Math.sin(time * 0.002) * 0.02;

      ctx.save();
      ctx.translate(dragonX, dragonY);

      // Body
      ctx.beginPath();
      ctx.ellipse(0, 0, size * breathScale, size * 0.6 * breathScale, 0, 0, Math.PI * 2);
      const bodyGradient = ctx.createRadialGradient(-size * 0.3, -size * 0.2, 0, 0, 0, size);
      bodyGradient.addColorStop(0, '#7b68ee');
      bodyGradient.addColorStop(0.5, '#6a5acd');
      bodyGradient.addColorStop(1, '#483d8b');
      ctx.fillStyle = bodyGradient;
      ctx.fill();

      // Draw shimmering scales
      scalesRef.current.forEach((scale) => {
        const shimmer = Math.sin(time * 0.003 + scale.shimmerPhase) * 0.3 + 0.7;
        const relX = scale.x - dragonX;
        const relY = scale.y - dragonY;

        ctx.beginPath();
        ctx.arc(relX, relY, scale.size * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(260, 60%, ${55 * shimmer}%, 0.6)`;
        ctx.fill();
      });

      // Belly
      ctx.beginPath();
      ctx.ellipse(size * 0.1, size * 0.15, size * 0.5, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9890d0';
      ctx.fill();

      // Tail curled around
      ctx.beginPath();
      ctx.moveTo(-size * 0.8, 0);
      ctx.quadraticCurveTo(-size * 1.3, size * 0.2, -size * 1.1, size * 0.5);
      ctx.quadraticCurveTo(-size * 0.8, size * 0.7, -size * 0.4, size * 0.5);
      ctx.strokeStyle = '#6a5acd';
      ctx.lineWidth = size * 0.12;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Tail spade
      ctx.beginPath();
      ctx.moveTo(-size * 0.4, size * 0.5);
      ctx.lineTo(-size * 0.5, size * 0.7);
      ctx.lineTo(-size * 0.3, size * 0.6);
      ctx.lineTo(-size * 0.35, size * 0.5);
      ctx.closePath();
      ctx.fillStyle = '#7b68ee';
      ctx.fill();

      // Head
      const headX = size * 0.6;
      const headY = -size * 0.2;
      ctx.beginPath();
      ctx.ellipse(headX, headY, size * 0.35, size * 0.28, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = '#7b68ee';
      ctx.fill();

      // Snout
      ctx.beginPath();
      ctx.ellipse(headX + size * 0.25, headY + size * 0.05, size * 0.15, size * 0.1, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#8878ee';
      ctx.fill();

      // Nostrils
      ctx.fillStyle = '#4a3a7a';
      ctx.beginPath();
      ctx.ellipse(headX + size * 0.35, headY + size * 0.02, size * 0.03, size * 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(headX + size * 0.35, headY + size * 0.08, size * 0.03, size * 0.02, 0, 0, Math.PI * 2);
      ctx.fill();

      // Horns
      ctx.beginPath();
      ctx.moveTo(headX - size * 0.1, headY - size * 0.2);
      ctx.quadraticCurveTo(headX - size * 0.2, headY - size * 0.4, headX - size * 0.15, headY - size * 0.5);
      ctx.strokeStyle = '#9090b0';
      ctx.lineWidth = size * 0.05;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(headX + size * 0.1, headY - size * 0.2);
      ctx.quadraticCurveTo(headX + size * 0.2, headY - size * 0.35, headX + size * 0.15, headY - size * 0.45);
      ctx.stroke();

      // Closed eyes
      ctx.strokeStyle = '#3a2a5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(headX, headY - size * 0.05, size * 0.06, 0.3, Math.PI - 0.3);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(headX + size * 0.15, headY - size * 0.02, size * 0.05, 0.3, Math.PI - 0.3);
      ctx.stroke();

      // Wing (folded)
      ctx.beginPath();
      ctx.moveTo(-size * 0.2, -size * 0.3);
      ctx.quadraticCurveTo(-size * 0.5, -size * 0.6, -size * 0.3, -size * 0.4);
      ctx.quadraticCurveTo(-size * 0.1, -size * 0.5, size * 0.1, -size * 0.3);
      ctx.quadraticCurveTo(size * 0.3, -size * 0.2, size * 0.2, -size * 0.1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(107, 90, 205, 0.7)';
      ctx.fill();

      // Wing membrane lines
      ctx.strokeStyle = 'rgba(90, 70, 180, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-size * 0.2, -size * 0.3);
      ctx.lineTo(-size * 0.3, -size * 0.4);
      ctx.moveTo(-size * 0.1, -size * 0.3);
      ctx.lineTo(-size * 0.1, -size * 0.45);
      ctx.moveTo(0, -size * 0.25);
      ctx.lineTo(size * 0.1, -size * 0.4);
      ctx.stroke();

      // Front leg/paw
      ctx.beginPath();
      ctx.ellipse(size * 0.4, size * 0.25, size * 0.12, size * 0.08, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#6a5acd';
      ctx.fill();

      // Claws
      ctx.fillStyle = '#e0e0e0';
      for (let c = 0; c < 3; c++) {
        ctx.beginPath();
        ctx.ellipse(
          size * 0.48 + c * size * 0.05,
          size * 0.28,
          size * 0.02,
          size * 0.04,
          0.5,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      ctx.restore();
    };

    const drawSmoke = () => {
      smokePuffsRef.current.forEach((puff, index) => {
        puff.x += puff.vx;
        puff.y += puff.vy;
        puff.size += 0.3;
        puff.opacity -= 0.005;

        if (puff.opacity <= 0) {
          smokePuffsRef.current.splice(index, 1);
          return;
        }

        ctx.beginPath();
        ctx.arc(puff.x, puff.y, puff.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(150, 150, 160, ${puff.opacity})`;
        ctx.fill();
      });
    };

    const drawEmbers = () => {
      embersRef.current.forEach((ember, index) => {
        ember.x += ember.vx;
        ember.y += ember.vy;
        ember.life -= 1;

        if (ember.life <= 0) {
          embersRef.current.splice(index, 1);
          return;
        }

        const opacity = ember.life / ember.maxLife;
        ctx.beginPath();
        ctx.arc(ember.x, ember.y, ember.size * opacity, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${ember.hue}, 100%, 60%, ${opacity})`;
        ctx.fill();
      });
    };

    const addSmoke = () => {
      const dragonX = canvas.width * 0.5;
      const dragonY = canvas.height * 0.6;
      const size = Math.min(canvas.width, canvas.height) * 0.15;

      // Smoke from nostrils
      for (let i = 0; i < 3; i++) {
        smokePuffsRef.current.push({
          x: dragonX + size * 0.85,
          y: dragonY - size * 0.15 + (Math.random() - 0.5) * 10,
          size: 5 + Math.random() * 5,
          opacity: 0.4,
          vx: 0.3 + Math.random() * 0.3,
          vy: -0.2 - Math.random() * 0.2,
        });
      }

      // A few embers
      for (let i = 0; i < 2; i++) {
        embersRef.current.push({
          x: dragonX + size * 0.85,
          y: dragonY - size * 0.15,
          size: 2 + Math.random() * 2,
          life: 60 + Math.random() * 40,
          maxLife: 100,
          vx: 0.5 + Math.random() * 0.5,
          vy: -0.5 - Math.random() * 0.5,
          hue: 20 + Math.random() * 30,
        });
      }
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      // Occasionally add smoke
      nextSmokeRef.current -= 16;
      if (nextSmokeRef.current <= 0) {
        addSmoke();
        nextSmokeRef.current = 4000 + Math.random() * 4000;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();
      drawNest();
      drawTreasure(time);
      drawDragon(time);
      drawSmoke();
      drawEmbers();

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
