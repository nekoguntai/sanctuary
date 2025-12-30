/**
 * Morning Dew Animation
 * Sparkling dewdrops with prismatic highlights
 */

import { useRef, useEffect } from 'react';

interface Dewdrop {
  x: number;
  y: number;
  size: number;
  formPhase: number;
  formSpeed: number;
  opacity: number;
  prismAngle: number;
  prismSpeed: number;
}

export function useMorningDew(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  _darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const dropsRef = useRef<Dewdrop[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Prismatic colors for light refraction
    const prismColors = [
      [255, 200, 200], // soft red
      [255, 230, 180], // soft orange
      [255, 255, 200], // soft yellow
      [200, 255, 200], // soft green
      [200, 230, 255], // soft blue
      [230, 200, 255], // soft violet
    ];

    const createDewdrop = (): Dewdrop => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: 4 + Math.random() * 8,
      formPhase: Math.random(),
      formSpeed: 0.05 + Math.random() * 0.05,
      opacity: 0.1 + Math.random() * 0.08,
      prismAngle: Math.random() * Math.PI * 2,
      prismSpeed: 0.2 + Math.random() * 0.2,
    });

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const dropCount = Math.floor((canvas.width * canvas.height) / 25000) + 10;
      dropsRef.current = Array.from({ length: dropCount }, createDewdrop);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawDewdrop = (drop: Dewdrop) => {
      const opacityMultiplier = opacity / 50;
      const form = (Math.sin(timeRef.current * drop.formSpeed + drop.formPhase * Math.PI * 2) + 1) / 2;
      const currentSize = drop.size * (0.7 + form * 0.3);
      const prismPhase = timeRef.current * drop.prismSpeed + drop.prismAngle;

      ctx.save();
      ctx.translate(drop.x, drop.y);

      // Draw drop body
      const gradient = ctx.createRadialGradient(
        -currentSize * 0.2, -currentSize * 0.2, 0,
        0, 0, currentSize
      );
      gradient.addColorStop(0, `rgba(255, 255, 255, ${drop.opacity * opacityMultiplier * 0.8})`);
      gradient.addColorStop(0.5, `rgba(220, 240, 255, ${drop.opacity * opacityMultiplier * 0.4})`);
      gradient.addColorStop(1, `rgba(200, 220, 240, ${drop.opacity * opacityMultiplier * 0.1})`);

      ctx.beginPath();
      ctx.arc(0, 0, currentSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw prismatic highlight
      const prismColorIndex = Math.floor((prismPhase / (Math.PI * 2)) * prismColors.length) % prismColors.length;
      const prismColor = prismColors[prismColorIndex];
      const prismX = Math.cos(prismPhase) * currentSize * 0.3;
      const prismY = Math.sin(prismPhase) * currentSize * 0.3;

      ctx.beginPath();
      ctx.arc(prismX - currentSize * 0.2, prismY - currentSize * 0.2, currentSize * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${prismColor[0]}, ${prismColor[1]}, ${prismColor[2]}, ${drop.opacity * opacityMultiplier * form * 0.4})`;
      ctx.fill();

      // Highlight sparkle
      ctx.beginPath();
      ctx.arc(-currentSize * 0.3, -currentSize * 0.3, currentSize * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${drop.opacity * opacityMultiplier * 0.6})`;
      ctx.fill();

      ctx.restore();
    };

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      dropsRef.current.forEach(drawDewdrop);

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, opacity, active]);
}
