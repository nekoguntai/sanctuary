/**
 * Floating Lanterns Animation
 * Warm glowing lanterns rising into the night sky
 */

import { useRef, useEffect } from 'react';

interface Lantern {
  x: number;
  y: number;
  size: number;
  speed: number;
  swayPhase: number;
  swaySpeed: number;
  swayAmplitude: number;
  glowPhase: number;
  glowSpeed: number;
  colorScheme: number;
  opacity: number;
}

export function useFloatingLanterns(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  _darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const lanternsRef = useRef<Lantern[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Warm lantern colors
    const colorSchemes = [
      { body: [255, 180, 100], glow: [255, 200, 130], flame: [255, 220, 150] },
      { body: [255, 160, 80], glow: [255, 185, 110], flame: [255, 210, 140] },
      { body: [255, 140, 90], glow: [255, 170, 120], flame: [255, 200, 145] },
      { body: [255, 200, 120], glow: [255, 220, 150], flame: [255, 235, 170] },
    ];

    const createLantern = (): Lantern => ({
      x: Math.random() * canvas.width,
      y: canvas.height + 50 + Math.random() * 100,
      size: 20 + Math.random() * 15,
      speed: 0.3 + Math.random() * 0.4,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.5 + Math.random() * 0.3,
      swayAmplitude: 15 + Math.random() * 20,
      glowPhase: Math.random() * Math.PI * 2,
      glowSpeed: 2 + Math.random() * 1,
      colorScheme: Math.floor(Math.random() * 4),
      opacity: 0.15 + Math.random() * 0.1,
    });

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const lanternCount = Math.floor(canvas.width / 150) + 4;
      lanternsRef.current = Array.from({ length: lanternCount }, createLantern);
      // Distribute initial positions
      lanternsRef.current.forEach((l) => {
        l.y = Math.random() * (canvas.height + 200) - 100;
      });
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawLantern = (lantern: Lantern) => {
      const opacityMultiplier = opacity / 50;
      const colors = colorSchemes[lantern.colorScheme];
      const sway = Math.sin(timeRef.current * lantern.swaySpeed + lantern.swayPhase) * lantern.swayAmplitude;
      const glowPulse = 0.7 + Math.sin(timeRef.current * lantern.glowSpeed + lantern.glowPhase) * 0.3;

      const x = lantern.x + sway;
      const y = lantern.y;

      ctx.save();

      // Draw glow
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, lantern.size * 2.5);
      gradient.addColorStop(0, `rgba(${colors.glow[0]}, ${colors.glow[1]}, ${colors.glow[2]}, ${lantern.opacity * opacityMultiplier * glowPulse})`);
      gradient.addColorStop(0.5, `rgba(${colors.glow[0]}, ${colors.glow[1]}, ${colors.glow[2]}, ${lantern.opacity * opacityMultiplier * glowPulse * 0.3})`);
      gradient.addColorStop(1, 'rgba(255, 200, 100, 0)');
      ctx.beginPath();
      ctx.arc(x, y, lantern.size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw lantern body
      ctx.beginPath();
      ctx.ellipse(x, y, lantern.size * 0.8, lantern.size, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.body[0]}, ${colors.body[1]}, ${colors.body[2]}, ${lantern.opacity * opacityMultiplier * 0.9})`;
      ctx.fill();

      // Draw top cap
      ctx.beginPath();
      ctx.ellipse(x, y - lantern.size * 0.9, lantern.size * 0.3, lantern.size * 0.15, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.body[0] - 40}, ${colors.body[1] - 40}, ${colors.body[2] - 40}, ${lantern.opacity * opacityMultiplier})`;
      ctx.fill();

      // Draw bottom opening
      ctx.beginPath();
      ctx.ellipse(x, y + lantern.size * 0.9, lantern.size * 0.4, lantern.size * 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.flame[0]}, ${colors.flame[1]}, ${colors.flame[2]}, ${lantern.opacity * opacityMultiplier * glowPulse})`;
      ctx.fill();

      ctx.restore();
    };

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      lanternsRef.current.forEach((lantern, i) => {
        lantern.y -= lantern.speed;

        // Reset when off screen
        if (lantern.y < -lantern.size * 3) {
          lanternsRef.current[i] = createLantern();
        }

        drawLantern(lantern);
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
  }, [canvasRef, opacity, active]);
}
