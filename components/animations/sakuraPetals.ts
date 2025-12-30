/**
 * Sakura Petals Animation
 * Gentle falling cherry blossom petals
 */

import { useRef, useEffect, useCallback } from 'react';

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

export function useSakuraPetals(
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
