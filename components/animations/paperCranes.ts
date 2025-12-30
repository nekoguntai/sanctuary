/**
 * Paper Cranes Animation
 * Origami cranes floating with gentle wing movements
 */

import { useRef, useEffect } from 'react';

interface PaperCrane {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  floatPhase: number;
  floatSpeed: number;
  wingPhase: number;
  wingSpeed: number;
  colorScheme: number;
  opacity: number;
  driftX: number;
  driftY: number;
}

export function usePaperCranes(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const cranesRef = useRef<PaperCrane[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Soft pastel colors
    const colorSchemes = darkMode
      ? [
          { body: [255, 200, 200], wing: [255, 180, 180], accent: [255, 220, 210] },
          { body: [200, 220, 255], wing: [180, 200, 255], accent: [210, 230, 255] },
          { body: [255, 245, 230], wing: [255, 235, 210], accent: [255, 250, 240] },
          { body: [220, 255, 220], wing: [200, 245, 200], accent: [230, 255, 235] },
        ]
      : [
          { body: [255, 180, 180], wing: [255, 150, 150], accent: [255, 200, 190] },
          { body: [180, 200, 255], wing: [150, 180, 255], accent: [190, 210, 255] },
          { body: [255, 230, 200], wing: [255, 210, 170], accent: [255, 240, 220] },
          { body: [200, 240, 200], wing: [170, 220, 170], accent: [210, 250, 215] },
        ];

    const createCrane = (): PaperCrane => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: 15 + Math.random() * 15,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.01,
      floatPhase: Math.random() * Math.PI * 2,
      floatSpeed: 0.5 + Math.random() * 0.3,
      wingPhase: Math.random() * Math.PI * 2,
      wingSpeed: 1.5 + Math.random() * 0.5,
      colorScheme: Math.floor(Math.random() * 4),
      opacity: 0.12 + Math.random() * 0.08,
      driftX: (Math.random() - 0.5) * 0.2,
      driftY: -0.1 - Math.random() * 0.1,
    });

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const craneCount = Math.floor((canvas.width * canvas.height) / 100000) + 5;
      cranesRef.current = Array.from({ length: craneCount }, createCrane);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawCrane = (crane: PaperCrane) => {
      const opacityMultiplier = opacity / 50;
      const colors = colorSchemes[crane.colorScheme];
      const wingFlap = Math.sin(timeRef.current * crane.wingSpeed + crane.wingPhase) * 0.3;
      const floatY = Math.sin(timeRef.current * crane.floatSpeed + crane.floatPhase) * 5;

      ctx.save();
      ctx.translate(crane.x, crane.y + floatY);
      ctx.rotate(crane.rotation);

      // Body (diamond shape)
      ctx.beginPath();
      ctx.moveTo(0, -crane.size * 0.8);
      ctx.lineTo(crane.size * 0.3, 0);
      ctx.lineTo(0, crane.size * 0.4);
      ctx.lineTo(-crane.size * 0.3, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.body[0]}, ${colors.body[1]}, ${colors.body[2]}, ${crane.opacity * opacityMultiplier})`;
      ctx.fill();

      // Left wing
      ctx.save();
      ctx.rotate(-0.5 + wingFlap);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-crane.size, -crane.size * 0.2);
      ctx.lineTo(-crane.size * 0.8, crane.size * 0.1);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.wing[0]}, ${colors.wing[1]}, ${colors.wing[2]}, ${crane.opacity * opacityMultiplier * 0.8})`;
      ctx.fill();
      ctx.restore();

      // Right wing
      ctx.save();
      ctx.rotate(0.5 - wingFlap);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(crane.size, -crane.size * 0.2);
      ctx.lineTo(crane.size * 0.8, crane.size * 0.1);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.wing[0]}, ${colors.wing[1]}, ${colors.wing[2]}, ${crane.opacity * opacityMultiplier * 0.8})`;
      ctx.fill();
      ctx.restore();

      // Head/neck
      ctx.beginPath();
      ctx.moveTo(0, -crane.size * 0.8);
      ctx.lineTo(crane.size * 0.1, -crane.size * 1.1);
      ctx.lineTo(-crane.size * 0.1, -crane.size * 1.1);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]}, ${crane.opacity * opacityMultiplier})`;
      ctx.fill();

      // Tail
      ctx.beginPath();
      ctx.moveTo(0, crane.size * 0.4);
      ctx.lineTo(crane.size * 0.15, crane.size * 0.8);
      ctx.lineTo(-crane.size * 0.15, crane.size * 0.8);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]}, ${crane.opacity * opacityMultiplier * 0.8})`;
      ctx.fill();

      ctx.restore();
    };

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      cranesRef.current.forEach((crane) => {
        crane.x += crane.driftX;
        crane.y += crane.driftY;
        crane.rotation += crane.rotationSpeed;

        // Wrap around
        if (crane.y < -crane.size * 2) crane.y = canvas.height + crane.size;
        if (crane.x < -crane.size * 2) crane.x = canvas.width + crane.size;
        if (crane.x > canvas.width + crane.size * 2) crane.x = -crane.size;

        drawCrane(crane);
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
  }, [canvasRef, darkMode, opacity, active]);
}
