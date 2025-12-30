/**
 * Spring Rain Animation
 * Gentle rainfall with occasional rainbow glimpses through the clouds.
 * Soft, peaceful atmosphere with varying rain intensity.
 */

import { useEffect, useRef } from 'react';

interface Raindrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  thickness: number;
}

interface Splash {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  rings: number;
}

interface RainbowArc {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  fadeIn: boolean;
  lifetime: number;
  maxLifetime: number;
}

interface Cloud {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  speed: number;
}

export function useSpringRain(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const raindropsRef = useRef<Raindrop[]>([]);
  const splashesRef = useRef<Splash[]>([]);
  const rainbowRef = useRef<RainbowArc | null>(null);
  const cloudsRef = useRef<Cloud[]>([]);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const rainbowTimerRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initializeClouds();
      initializeRain();
    };

    const initializeClouds = () => {
      cloudsRef.current = [];
      const cloudCount = Math.floor(canvas.width / 300) + 2;
      for (let i = 0; i < cloudCount; i++) {
        cloudsRef.current.push({
          x: Math.random() * canvas.width,
          y: 20 + Math.random() * 80,
          width: 150 + Math.random() * 200,
          height: 40 + Math.random() * 40,
          opacity: 0.3 + Math.random() * 0.3,
          speed: 0.1 + Math.random() * 0.2,
        });
      }
    };

    const initializeRain = () => {
      raindropsRef.current = [];
      const dropCount = Math.floor((canvas.width * canvas.height) / 8000);
      for (let i = 0; i < dropCount; i++) {
        raindropsRef.current.push(createRaindrop(true));
      }
    };

    const createRaindrop = (randomY = false): Raindrop => {
      return {
        x: Math.random() * canvas.width,
        y: randomY ? Math.random() * canvas.height : -20,
        length: 15 + Math.random() * 25,
        speed: 8 + Math.random() * 6,
        opacity: 0.2 + Math.random() * 0.4,
        thickness: 1 + Math.random() * 1.5,
      };
    };

    const createSplash = (x: number, y: number): Splash => {
      return {
        x,
        y,
        radius: 0,
        maxRadius: 8 + Math.random() * 8,
        opacity: 0.6,
        rings: 2 + Math.floor(Math.random() * 2),
      };
    };

    const tryCreateRainbow = () => {
      // Only create rainbow occasionally when there isn't one
      if (!rainbowRef.current && Math.random() < 0.002) {
        rainbowRef.current = {
          x: canvas.width * 0.3 + Math.random() * canvas.width * 0.4,
          y: canvas.height * 0.6 + Math.random() * canvas.height * 0.2,
          radius: Math.min(canvas.width, canvas.height) * 0.4,
          opacity: 0,
          fadeIn: true,
          lifetime: 0,
          maxLifetime: 300 + Math.random() * 200, // 5-8 seconds
        };
      }
    };

    const drawCloud = (cloud: Cloud, opacityMult: number) => {
      const cloudColor = darkMode
        ? `rgba(60, 70, 90, ${cloud.opacity * opacityMult})`
        : `rgba(200, 210, 220, ${cloud.opacity * opacityMult})`;

      ctx.fillStyle = cloudColor;

      // Draw fluffy cloud shape with overlapping circles
      const cx = cloud.x;
      const cy = cloud.y;
      const w = cloud.width;
      const h = cloud.height;

      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.3, h * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(cx - w * 0.25, cy + h * 0.1, w * 0.25, h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(cx + w * 0.25, cy + h * 0.1, w * 0.25, h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(cx - w * 0.1, cy - h * 0.2, w * 0.2, h * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(cx + w * 0.15, cy - h * 0.15, w * 0.18, h * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawRaindrop = (drop: Raindrop, opacityMult: number) => {
      const rainColor = darkMode
        ? `rgba(150, 180, 220, ${drop.opacity * opacityMult})`
        : `rgba(100, 140, 200, ${drop.opacity * opacityMult})`;

      ctx.strokeStyle = rainColor;
      ctx.lineWidth = drop.thickness;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x + drop.length * 0.1, drop.y + drop.length);
      ctx.stroke();
    };

    const drawSplash = (splash: Splash, opacityMult: number) => {
      const splashColor = darkMode
        ? `rgba(150, 180, 220, ${splash.opacity * opacityMult})`
        : `rgba(100, 140, 200, ${splash.opacity * opacityMult})`;

      ctx.strokeStyle = splashColor;
      ctx.lineWidth = 1;

      for (let i = 0; i < splash.rings; i++) {
        const ringRadius = splash.radius * (1 - i * 0.3);
        const ringOpacity = splash.opacity * (1 - i * 0.3);
        ctx.strokeStyle = darkMode
          ? `rgba(150, 180, 220, ${ringOpacity * opacityMult})`
          : `rgba(100, 140, 200, ${ringOpacity * opacityMult})`;

        ctx.beginPath();
        ctx.ellipse(splash.x, splash.y, ringRadius, ringRadius * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const drawRainbow = (rainbow: RainbowArc, opacityMult: number) => {
      const colors = [
        { r: 255, g: 0, b: 0 },     // Red
        { r: 255, g: 127, b: 0 },   // Orange
        { r: 255, g: 255, b: 0 },   // Yellow
        { r: 0, g: 255, b: 0 },     // Green
        { r: 0, g: 0, b: 255 },     // Blue
        { r: 75, g: 0, b: 130 },    // Indigo
        { r: 148, g: 0, b: 211 },   // Violet
      ];

      const bandWidth = rainbow.radius * 0.08;

      colors.forEach((color, i) => {
        const radius = rainbow.radius - i * bandWidth;
        const alpha = rainbow.opacity * opacityMult * 0.3;

        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        ctx.lineWidth = bandWidth;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.arc(rainbow.x, rainbow.y, radius, Math.PI, 0, false);
        ctx.stroke();
      });
    };

    const animate = () => {
      timeRef.current += 16;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const opacityMult = opacity / 50;

      // Draw and update clouds
      cloudsRef.current.forEach((cloud) => {
        cloud.x += cloud.speed;
        if (cloud.x - cloud.width > canvas.width) {
          cloud.x = -cloud.width;
        }
        drawCloud(cloud, opacityMult);
      });

      // Draw rainbow if present
      if (rainbowRef.current) {
        const rainbow = rainbowRef.current;
        rainbow.lifetime++;

        if (rainbow.fadeIn) {
          rainbow.opacity = Math.min(1, rainbow.opacity + 0.008);
          if (rainbow.opacity >= 1) rainbow.fadeIn = false;
        }

        if (rainbow.lifetime > rainbow.maxLifetime) {
          rainbow.opacity -= 0.01;
          if (rainbow.opacity <= 0) {
            rainbowRef.current = null;
            rainbowTimerRef.current = 0;
          }
        }

        if (rainbowRef.current) {
          drawRainbow(rainbow, opacityMult);
        }
      } else {
        rainbowTimerRef.current++;
        if (rainbowTimerRef.current > 500) { // Wait ~8 seconds between rainbows
          tryCreateRainbow();
        }
      }

      // Update and draw raindrops
      raindropsRef.current.forEach((drop, index) => {
        drop.y += drop.speed;
        drop.x += drop.speed * 0.1; // Slight angle

        // Create splash when hitting ground
        if (drop.y > canvas.height - 10) {
          if (Math.random() < 0.3) { // Only some drops create visible splashes
            splashesRef.current.push(createSplash(drop.x, canvas.height - 5));
          }
          raindropsRef.current[index] = createRaindrop(false);
        }

        drawRaindrop(drop, opacityMult);
      });

      // Update and draw splashes
      splashesRef.current = splashesRef.current.filter((splash) => {
        splash.radius += 0.8;
        splash.opacity -= 0.04;

        if (splash.opacity <= 0) return false;

        drawSplash(splash, opacityMult);
        return true;
      });

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
