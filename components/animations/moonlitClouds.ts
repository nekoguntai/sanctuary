/**
 * Moonlit Clouds Animation
 * Soft clouds drifting across a moonlit sky
 */

import { useRef, useEffect } from 'react';

interface Cloud {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  opacity: number;
  puffs: Array<{ x: number; y: number; r: number }>;
}

export function useMoonlitClouds(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const cloudsRef = useRef<Cloud[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cloudColor = darkMode ? [180, 190, 210] : [200, 210, 230];
    const moonGlow = darkMode ? [220, 230, 250] : [240, 245, 255];

    const createCloud = (startX?: number): Cloud => {
      const width = 100 + Math.random() * 150;
      const height = 40 + Math.random() * 30;
      const puffCount = 4 + Math.floor(Math.random() * 3);
      const puffs = Array.from({ length: puffCount }, (_, i) => ({
        x: (i / puffCount) * width - width / 2 + Math.random() * 20,
        y: (Math.random() - 0.5) * height * 0.5,
        r: 20 + Math.random() * 25,
      }));

      return {
        x: startX ?? -width,
        y: Math.random() * canvas.height * 0.6 + canvas.height * 0.1,
        width,
        height,
        speed: 0.15 + Math.random() * 0.2,
        opacity: 0.06 + Math.random() * 0.06,
        puffs,
      };
    };

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const cloudCount = Math.floor(canvas.width / 300) + 3;
      cloudsRef.current = Array.from({ length: cloudCount }, () =>
        createCloud(Math.random() * (canvas.width + 200) - 100)
      );
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawCloud = (cloud: Cloud) => {
      const opacityMultiplier = opacity / 50;

      ctx.save();
      ctx.translate(cloud.x, cloud.y);

      // Draw cloud puffs
      cloud.puffs.forEach(puff => {
        const gradient = ctx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.r);
        gradient.addColorStop(0, `rgba(${cloudColor[0]}, ${cloudColor[1]}, ${cloudColor[2]}, ${cloud.opacity * opacityMultiplier})`);
        gradient.addColorStop(0.6, `rgba(${cloudColor[0]}, ${cloudColor[1]}, ${cloudColor[2]}, ${cloud.opacity * opacityMultiplier * 0.5})`);
        gradient.addColorStop(1, `rgba(${cloudColor[0]}, ${cloudColor[1]}, ${cloudColor[2]}, 0)`);

        ctx.beginPath();
        ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      });

      // Subtle moon glow effect on top edge
      const glowGradient = ctx.createLinearGradient(0, -cloud.height, 0, cloud.height * 0.5);
      glowGradient.addColorStop(0, `rgba(${moonGlow[0]}, ${moonGlow[1]}, ${moonGlow[2]}, ${cloud.opacity * opacityMultiplier * 0.3})`);
      glowGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.beginPath();
      ctx.ellipse(0, -cloud.height * 0.3, cloud.width * 0.4, cloud.height * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = glowGradient;
      ctx.fill();

      ctx.restore();
    };

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      cloudsRef.current.forEach((cloud, i) => {
        cloud.x += cloud.speed;

        if (cloud.x > canvas.width + cloud.width) {
          cloudsRef.current[i] = createCloud();
        }

        drawCloud(cloud);
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
