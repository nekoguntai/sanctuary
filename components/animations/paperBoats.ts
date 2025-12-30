/**
 * Paper Boats Animation
 *
 * Tiny paper boats floating on a gentle stream
 * with fallen petals, creating a serene scene.
 */

import { useEffect, useRef } from 'react';

interface PaperBoat {
  x: number;
  y: number;
  size: number;
  color: string;
  bobPhase: number;
  bobSpeed: number;
  speedX: number;
  rotation: number;
  rotationSpeed: number;
}

interface Petal {
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  speedX: number;
  speedY: number;
  sway: number;
  swaySpeed: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
}

interface StreamLine {
  y: number;
  phase: number;
  speed: number;
  amplitude: number;
}

export function usePaperBoats(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  enabled: boolean
) {
  const boatsRef = useRef<PaperBoat[]>([]);
  const petalsRef = useRef<Petal[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const streamLinesRef = useRef<StreamLine[]>([]);
  const animationRef = useRef<number>();
  const timeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const width = canvas.getBoundingClientRect().width;
    const height = canvas.getBoundingClientRect().height;

    // Boat colors (pastel)
    const boatColors = darkMode
      ? ['#e8d5c4', '#d4c4b8', '#c8b8a8', '#f0e0d0', '#ddd0c0']
      : ['#fff8f0', '#fff0e8', '#ffe8e0', '#fff0f8', '#f8f0ff'];

    // Petal colors
    const petalColors = darkMode
      ? ['#d4a0a0', '#c8a0b0', '#d0a8a8', '#c0a0a8', '#d8b0b0']
      : ['#ffb8b8', '#ffc0c8', '#ffd0d0', '#ffc8d8', '#ffe0e0'];

    // Initialize stream flow lines
    streamLinesRef.current = [];
    for (let i = 0; i < 8; i++) {
      streamLinesRef.current.push({
        y: height * 0.2 + (height * 0.6 / 8) * i,
        phase: Math.random() * Math.PI * 2,
        speed: 0.02 + Math.random() * 0.01,
        amplitude: 3 + Math.random() * 4,
      });
    }

    // Initialize boats
    boatsRef.current = [];
    for (let i = 0; i < 4; i++) {
      boatsRef.current.push({
        x: Math.random() * width,
        y: height * 0.3 + Math.random() * height * 0.4,
        size: 20 + Math.random() * 15,
        color: boatColors[Math.floor(Math.random() * boatColors.length)],
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.03 + Math.random() * 0.02,
        speedX: 0.3 + Math.random() * 0.3,
        rotation: (Math.random() - 0.5) * 0.2,
        rotationSpeed: (Math.random() - 0.5) * 0.01,
      });
    }

    // Initialize petals
    petalsRef.current = [];
    for (let i = 0; i < 15; i++) {
      petalsRef.current.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 4 + Math.random() * 6,
        color: petalColors[Math.floor(Math.random() * petalColors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.05,
        speedX: 0.2 + Math.random() * 0.3,
        speedY: 0.1 + Math.random() * 0.2,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.02 + Math.random() * 0.02,
      });
    }

    ripplesRef.current = [];

    const drawPaperBoat = (ctx: CanvasRenderingContext2D, boat: PaperBoat) => {
      const bob = Math.sin(boat.bobPhase) * 2;

      ctx.save();
      ctx.translate(boat.x, boat.y + bob);
      ctx.rotate(boat.rotation);

      const s = boat.size;

      // Boat hull
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, 0);
      ctx.lineTo(-s * 0.3, s * 0.3);
      ctx.lineTo(s * 0.3, s * 0.3);
      ctx.lineTo(s * 0.5, 0);
      ctx.closePath();

      ctx.fillStyle = boat.color;
      ctx.fill();
      ctx.strokeStyle = darkMode ? '#a09080' : '#d0c0b0';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Boat sail (triangular)
      ctx.beginPath();
      ctx.moveTo(0, s * 0.25);
      ctx.lineTo(0, -s * 0.5);
      ctx.lineTo(s * 0.3, s * 0.1);
      ctx.closePath();

      ctx.fillStyle = boat.color;
      ctx.fill();
      ctx.stroke();

      // Mast
      ctx.beginPath();
      ctx.moveTo(0, s * 0.25);
      ctx.lineTo(0, -s * 0.5);
      ctx.strokeStyle = darkMode ? '#806050' : '#a08070';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Fold lines for paper effect
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, s * 0.05);
      ctx.lineTo(0, s * 0.25);
      ctx.lineTo(s * 0.4, s * 0.05);
      ctx.strokeStyle = darkMode ? 'rgba(100, 80, 60, 0.3)' : 'rgba(180, 160, 140, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.restore();
    };

    const drawPetal = (ctx: CanvasRenderingContext2D, petal: Petal) => {
      ctx.save();
      ctx.translate(petal.x, petal.y);
      ctx.rotate(petal.rotation);

      // Petal shape (ellipse with pointed end)
      ctx.beginPath();
      ctx.ellipse(0, 0, petal.size, petal.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = petal.color;
      ctx.fill();

      // Subtle gradient
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, petal.size);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.restore();
    };

    const animate = () => {
      const currentWidth = canvas.getBoundingClientRect().width;
      const currentHeight = canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, currentWidth, currentHeight);
      timeRef.current += 0.016;

      // Sky/background gradient
      const bgGradient = ctx.createLinearGradient(0, 0, 0, currentHeight);
      if (darkMode) {
        bgGradient.addColorStop(0, '#1a2030');
        bgGradient.addColorStop(0.3, '#202838');
        bgGradient.addColorStop(0.7, '#253040');
        bgGradient.addColorStop(1, '#1a2530');
      } else {
        bgGradient.addColorStop(0, '#e8f0f8');
        bgGradient.addColorStop(0.3, '#d8e8f0');
        bgGradient.addColorStop(0.7, '#c8e0f0');
        bgGradient.addColorStop(1, '#b8d8e8');
      }
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, currentWidth, currentHeight);

      // Stream water area
      const streamTop = currentHeight * 0.2;
      const streamBottom = currentHeight * 0.85;

      const waterGradient = ctx.createLinearGradient(0, streamTop, 0, streamBottom);
      if (darkMode) {
        waterGradient.addColorStop(0, 'rgba(40, 60, 80, 0.6)');
        waterGradient.addColorStop(0.5, 'rgba(50, 70, 90, 0.7)');
        waterGradient.addColorStop(1, 'rgba(40, 60, 80, 0.6)');
      } else {
        waterGradient.addColorStop(0, 'rgba(160, 200, 220, 0.5)');
        waterGradient.addColorStop(0.5, 'rgba(140, 190, 220, 0.6)');
        waterGradient.addColorStop(1, 'rgba(150, 195, 215, 0.5)');
      }
      ctx.fillStyle = waterGradient;
      ctx.fillRect(0, streamTop, currentWidth, streamBottom - streamTop);

      // Draw stream flow lines
      streamLinesRef.current.forEach((line) => {
        line.phase += line.speed;

        ctx.beginPath();
        ctx.moveTo(0, line.y);

        for (let x = 0; x <= currentWidth; x += 10) {
          const y = line.y + Math.sin(x * 0.01 + line.phase) * line.amplitude;
          ctx.lineTo(x, y);
        }

        ctx.strokeStyle = darkMode
          ? 'rgba(80, 100, 120, 0.25)'
          : 'rgba(180, 210, 230, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Update and draw ripples
      ripplesRef.current = ripplesRef.current.filter((ripple) => {
        ripple.radius += 0.5;
        ripple.opacity -= 0.015;

        if (ripple.opacity <= 0) return false;

        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.strokeStyle = darkMode
          ? `rgba(100, 130, 160, ${ripple.opacity})`
          : `rgba(200, 220, 240, ${ripple.opacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        return true;
      });

      // Update and draw petals (both in water and drifting)
      petalsRef.current.forEach((petal) => {
        petal.sway += petal.swaySpeed;
        petal.x += petal.speedX + Math.sin(petal.sway) * 0.5;
        petal.y += petal.speedY;
        petal.rotation += petal.rotationSpeed;

        // Wrap around
        if (petal.x > currentWidth + 20) {
          petal.x = -20;
          petal.y = Math.random() * currentHeight;
        }
        if (petal.y > currentHeight + 20) {
          petal.y = -20;
          petal.x = Math.random() * currentWidth;
        }

        // Check if petal is in water (slows down)
        const inWater = petal.y > streamTop && petal.y < streamBottom;
        if (inWater) {
          petal.speedY *= 0.99;
          petal.speedX = 0.2 + Math.random() * 0.1;
        }

        drawPetal(ctx, petal);
      });

      // Update and draw boats
      boatsRef.current.forEach((boat) => {
        boat.bobPhase += boat.bobSpeed;
        boat.x += boat.speedX;
        boat.rotation += boat.rotationSpeed;

        // Clamp rotation
        if (Math.abs(boat.rotation) > 0.15) {
          boat.rotationSpeed *= -0.5;
        }

        // Wrap around
        if (boat.x > currentWidth + 50) {
          boat.x = -50;
          boat.y = currentHeight * 0.3 + Math.random() * currentHeight * 0.4;
        }

        // Occasionally spawn ripples from boats
        if (Math.random() < 0.02) {
          ripplesRef.current.push({
            x: boat.x,
            y: boat.y + boat.size * 0.3,
            radius: 3,
            maxRadius: 20,
            opacity: 0.4,
          });
        }

        drawPaperBoat(ctx, boat);
      });

      // Limit ripples
      if (ripplesRef.current.length > 30) {
        ripplesRef.current = ripplesRef.current.slice(-25);
      }

      // Bank/edge decorations (grass-like)
      const drawBankGrass = (y: number, reverse: boolean) => {
        ctx.strokeStyle = darkMode ? '#304030' : '#80a080';
        ctx.lineWidth = 1.5;

        for (let x = 0; x < currentWidth; x += 15) {
          const h = 8 + Math.random() * 8;
          const sway = Math.sin(timeRef.current * 2 + x * 0.1) * 2;

          ctx.beginPath();
          ctx.moveTo(x, y);
          if (reverse) {
            ctx.quadraticCurveTo(x + sway, y + h * 0.5, x + sway * 0.5, y + h);
          } else {
            ctx.quadraticCurveTo(x + sway, y - h * 0.5, x + sway * 0.5, y - h);
          }
          ctx.stroke();
        }
      };

      drawBankGrass(streamTop, false);
      drawBankGrass(streamBottom, true);

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, enabled]);
}
