/**
 * Sanctuary Logo Animation
 * Scattered floating Sanctuary logos across the screen
 */

import { useRef, useEffect, useCallback } from 'react';

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

function drawSanctuaryLogoShape(
  ctx: CanvasRenderingContext2D,
  size: number,
  _isDark: boolean,
  alpha: number
) {
  const goldColor = { r: 212, g: 160, b: 23 };
  const strokeColor = `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha})`;
  const fillColor = `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha * 0.3})`;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const scale = size / 20;

  // Top diamond
  ctx.beginPath();
  ctx.moveTo(0, -10 * scale);
  ctx.lineTo(-10 * scale, -5 * scale);
  ctx.lineTo(0, 0);
  ctx.lineTo(10 * scale, -5 * scale);
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

  // Outer glow
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

export function useSanctuaryLogo(
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
        const currentX = logo.x + Math.sin(timeRef.current * 0.2 + logo.driftPhaseX) * logo.driftX;
        const currentY = logo.y + Math.cos(timeRef.current * 0.15 + logo.driftPhaseY) * logo.driftY;

        logo.rotation += logo.rotationSpeed;

        const pulseOpacity = logo.opacity + Math.sin(timeRef.current * 0.5 + logo.pulsePhase) * 0.08;
        const pulseScale = 1 + Math.sin(timeRef.current * 0.3 + logo.pulsePhase) * 0.05;

        ctx.save();
        ctx.translate(currentX, currentY);
        ctx.rotate(logo.rotation);
        ctx.scale(pulseScale, pulseScale);

        drawSanctuaryLogoShape(ctx, logo.size, darkMode, pulseOpacity * opacityMultiplier);

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
