/**
 * Aurora Waves Animation (replaces aurora static)
 *
 * Beautiful animated aurora borealis with flowing color bands.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface AuroraBand {
  yBase: number;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
  hue: number;
  targetHue: number;
  opacity: number;
  thickness: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  twinklePhase: number;
  twinkleSpeed: number;
  brightness: number;
}

export function useAuroraWaves(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const bandsRef = useRef<AuroraBand[]>([]);
  const starsRef = useRef<Star[]>([]);
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

      // Create aurora bands
      bandsRef.current = [];
      const bandCount = 5;

      for (let i = 0; i < bandCount; i++) {
        const baseHue = 120 + Math.random() * 60; // Green to cyan
        bandsRef.current.push({
          yBase: height * (0.2 + i * 0.12),
          amplitude: 30 + Math.random() * 40,
          frequency: 0.002 + Math.random() * 0.002,
          speed: 0.0003 + Math.random() * 0.0003,
          phase: Math.random() * Math.PI * 2,
          hue: baseHue,
          targetHue: baseHue,
          opacity: 0.2 + Math.random() * 0.2,
          thickness: 40 + Math.random() * 60,
        });
      }

      // Create stars
      starsRef.current = [];
      const starCount = 80;
      for (let i = 0; i < starCount; i++) {
        starsRef.current.push({
          x: Math.random() * width,
          y: Math.random() * height * 0.7,
          size: 0.5 + Math.random() * 1.5,
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.01 + Math.random() * 0.02,
          brightness: 0.3 + Math.random() * 0.7,
        });
      }
    };

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      if (darkMode) {
        gradient.addColorStop(0, '#020510');
        gradient.addColorStop(0.5, '#051020');
        gradient.addColorStop(1, '#0a1525');
      } else {
        gradient.addColorStop(0, '#1a2035');
        gradient.addColorStop(0.5, '#253050');
        gradient.addColorStop(1, '#304060');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawStars = (time: number) => {
      starsRef.current.forEach((star) => {
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinklePhase) * 0.5 + 0.5;
        const alpha = star.brightness * twinkle;

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();
      });
    };

    const drawAuroraBand = (band: AuroraBand, time: number) => {
      // Slowly shift hue
      if (Math.random() > 0.998) {
        band.targetHue = 100 + Math.random() * 80; // Green to blue-green range
      }
      band.hue += (band.targetHue - band.hue) * 0.001;

      ctx.beginPath();

      // Draw the flowing aurora band
      for (let x = 0; x <= canvas.width; x += 3) {
        const waveY =
          band.yBase +
          Math.sin(x * band.frequency + time * band.speed + band.phase) * band.amplitude +
          Math.sin(x * band.frequency * 2.3 + time * band.speed * 1.5 + band.phase * 1.7) *
            band.amplitude *
            0.3 +
          Math.sin(x * band.frequency * 0.5 + time * band.speed * 0.7) * band.amplitude * 0.5;

        if (x === 0) {
          ctx.moveTo(x, waveY);
        } else {
          ctx.lineTo(x, waveY);
        }
      }

      // Close the shape
      for (let x = canvas.width; x >= 0; x -= 3) {
        const waveY =
          band.yBase +
          band.thickness +
          Math.sin(x * band.frequency + time * band.speed + band.phase + 0.5) * band.amplitude * 0.8 +
          Math.sin(x * band.frequency * 2 + time * band.speed * 1.3 + band.phase * 1.5) *
            band.amplitude *
            0.2;
        ctx.lineTo(x, waveY);
      }

      ctx.closePath();

      // Create gradient for the band
      const gradient = ctx.createLinearGradient(0, band.yBase, 0, band.yBase + band.thickness);
      gradient.addColorStop(0, `hsla(${band.hue}, 80%, 60%, ${band.opacity * 0.8})`);
      gradient.addColorStop(0.3, `hsla(${band.hue + 20}, 70%, 50%, ${band.opacity})`);
      gradient.addColorStop(0.7, `hsla(${band.hue + 40}, 60%, 45%, ${band.opacity * 0.8})`);
      gradient.addColorStop(1, `hsla(${band.hue + 60}, 50%, 40%, ${band.opacity * 0.3})`);

      ctx.fillStyle = gradient;
      ctx.fill();

      // Add glow effect
      ctx.shadowColor = `hsla(${band.hue}, 100%, 60%, 0.5)`;
      ctx.shadowBlur = 30;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    const drawReflection = (time: number) => {
      // Ground/water reflection at bottom
      const reflectionY = canvas.height * 0.85;

      // Dark ground
      ctx.fillStyle = darkMode ? '#0a0a15' : '#151525';
      ctx.fillRect(0, reflectionY, canvas.width, canvas.height - reflectionY);

      // Reflected aurora glow
      bandsRef.current.forEach((band) => {
        const reflectedY = canvas.height - (band.yBase - reflectionY) * 0.3 + 50;
        const gradient = ctx.createLinearGradient(0, reflectedY, 0, canvas.height);
        gradient.addColorStop(0, `hsla(${band.hue}, 60%, 40%, ${band.opacity * 0.15})`);
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, reflectedY, canvas.width, canvas.height - reflectedY);
      });
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();
      drawStars(time);

      // Draw aurora bands
      bandsRef.current.forEach((band) => drawAuroraBand(band, time));

      drawReflection(time);

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
