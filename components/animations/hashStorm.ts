/**
 * Hash Storm Animation
 * Cryptographic characters swirling like a data tornado.
 * Hexadecimal characters and hash fragments spinning in a vortex.
 */

import { useEffect, useRef } from 'react';

interface HashChar {
  x: number;
  y: number;
  char: string;
  angle: number;
  radius: number;
  targetRadius: number;
  speed: number;
  verticalSpeed: number;
  opacity: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  layer: number;
}

interface DataStream {
  chars: string;
  x: number;
  y: number;
  targetY: number;
  opacity: number;
  speed: number;
}

export function useHashStorm(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const charsRef = useRef<HashChar[]>([]);
  const streamsRef = useRef<DataStream[]>([]);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const centerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hexChars = '0123456789abcdef';
    const hashPrefixes = ['0x', 'SHA', '256', 'BTC', '###'];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      centerRef.current = {
        x: canvas.width / 2,
        y: canvas.height / 2,
      };
      initializeChars();
    };

    const initializeChars = () => {
      charsRef.current = [];
      streamsRef.current = [];

      const charCount = Math.floor((canvas.width * canvas.height) / 8000);

      for (let i = 0; i < charCount; i++) {
        charsRef.current.push(createChar(true));
      }
    };

    const createChar = (randomPosition = false): HashChar => {
      const angle = Math.random() * Math.PI * 2;
      const maxRadius = Math.min(canvas.width, canvas.height) * 0.45;
      const radius = randomPosition
        ? Math.random() * maxRadius
        : maxRadius + 50;

      // Mix of hex chars and occasional hash-related strings
      let char: string;
      if (Math.random() < 0.85) {
        char = hexChars[Math.floor(Math.random() * hexChars.length)];
      } else {
        char = hashPrefixes[Math.floor(Math.random() * hashPrefixes.length)];
      }

      return {
        x: centerRef.current.x + Math.cos(angle) * radius,
        y: centerRef.current.y + Math.sin(angle) * radius,
        char,
        angle,
        radius,
        targetRadius: 20 + Math.random() * (maxRadius - 40),
        speed: 0.01 + Math.random() * 0.02,
        verticalSpeed: (Math.random() - 0.5) * 0.5,
        opacity: 0.3 + Math.random() * 0.5,
        size: 10 + Math.random() * 14,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.05,
        layer: Math.random(),
      };
    };

    const createStream = (): DataStream => {
      const hashLength = 8 + Math.floor(Math.random() * 16);
      let chars = '';
      for (let i = 0; i < hashLength; i++) {
        chars += hexChars[Math.floor(Math.random() * hexChars.length)];
      }

      return {
        chars,
        x: Math.random() * canvas.width,
        y: -20,
        targetY: canvas.height + 20,
        opacity: 0.2 + Math.random() * 0.3,
        speed: 2 + Math.random() * 4,
      };
    };

    const drawChar = (hashChar: HashChar, opacityMult: number, time: number) => {
      ctx.save();
      ctx.translate(hashChar.x, hashChar.y);
      ctx.rotate(hashChar.rotation);

      const alpha = hashChar.opacity * opacityMult;

      // Glow effect for closer chars (smaller radius)
      const maxRadius = Math.min(canvas.width, canvas.height) * 0.45;
      const glowIntensity = 1 - (hashChar.radius / maxRadius);

      if (glowIntensity > 0.3) {
        const glowColor = darkMode
          ? `rgba(0, 255, 150, ${alpha * glowIntensity * 0.5})`
          : `rgba(0, 200, 100, ${alpha * glowIntensity * 0.5})`;

        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 10 * glowIntensity;
      }

      // Character color based on depth
      const baseColor = darkMode
        ? { r: 0, g: 200 + Math.floor(55 * glowIntensity), b: 100 + Math.floor(100 * glowIntensity) }
        : { r: 0, g: 150 + Math.floor(50 * glowIntensity), b: 80 + Math.floor(70 * glowIntensity) };

      ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;
      ctx.font = `${hashChar.size}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hashChar.char, 0, 0);

      ctx.restore();
    };

    const drawStream = (stream: DataStream, opacityMult: number) => {
      const alpha = stream.opacity * opacityMult;
      const charSpacing = 14;

      ctx.font = '12px monospace';
      ctx.textAlign = 'center';

      for (let i = 0; i < stream.chars.length; i++) {
        const charY = stream.y + i * charSpacing;
        const fadeStart = stream.y;
        const fadeEnd = stream.y + stream.chars.length * charSpacing;
        const charAlpha = alpha * (1 - Math.abs((charY - (fadeStart + fadeEnd) / 2) / ((fadeEnd - fadeStart) / 2)));

        const color = darkMode
          ? `rgba(0, 255, 150, ${Math.max(0, charAlpha)})`
          : `rgba(0, 200, 100, ${Math.max(0, charAlpha)})`;

        ctx.fillStyle = color;
        ctx.fillText(stream.chars[i], stream.x, charY);
      }
    };

    const drawVortexCore = (opacityMult: number, time: number) => {
      const cx = centerRef.current.x;
      const cy = centerRef.current.y;
      const coreRadius = 30;

      // Pulsing core
      const pulse = Math.sin(time * 0.005) * 0.2 + 0.8;

      // Core glow
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 3 * pulse);
      const coreColor = darkMode
        ? { r: 0, g: 255, b: 150 }
        : { r: 0, g: 200, b: 100 };

      gradient.addColorStop(0, `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${0.8 * opacityMult})`);
      gradient.addColorStop(0.3, `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${0.4 * opacityMult})`);
      gradient.addColorStop(0.7, `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${0.1 * opacityMult})`);
      gradient.addColorStop(1, 'rgba(0, 255, 150, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 3 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Inner core
      ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * opacityMult})`;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 0.3 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Rotating hash ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 0.002);

      const ringText = 'SHA256';
      ctx.font = '10px monospace';
      ctx.fillStyle = `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${0.6 * opacityMult})`;

      for (let i = 0; i < ringText.length; i++) {
        const charAngle = (i / ringText.length) * Math.PI * 2;
        const charX = Math.cos(charAngle) * coreRadius;
        const charY = Math.sin(charAngle) * coreRadius;

        ctx.save();
        ctx.translate(charX, charY);
        ctx.rotate(charAngle + Math.PI / 2);
        ctx.fillText(ringText[i], 0, 0);
        ctx.restore();
      }

      ctx.restore();
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const opacityMult = opacity / 50;

      // Occasionally add data streams
      if (Math.random() < 0.03) {
        streamsRef.current.push(createStream());
      }

      // Draw and update streams (background layer)
      streamsRef.current = streamsRef.current.filter((stream) => {
        stream.y += stream.speed;

        if (stream.y > canvas.height + 100) return false;

        drawStream(stream, opacityMult);
        return true;
      });

      // Sort chars by layer for depth effect
      charsRef.current.sort((a, b) => a.layer - b.layer);

      // Update and draw swirling characters
      charsRef.current.forEach((hashChar, index) => {
        // Spiral inward
        hashChar.radius += (hashChar.targetRadius - hashChar.radius) * 0.01;

        // When reaching target, set new target or reset
        if (Math.abs(hashChar.radius - hashChar.targetRadius) < 5) {
          if (hashChar.targetRadius < 50) {
            // Reset to outer edge
            charsRef.current[index] = createChar(false);
            return;
          } else {
            // Move closer to center
            hashChar.targetRadius = Math.max(20, hashChar.targetRadius - 30 - Math.random() * 50);
          }
        }

        // Rotate around center - faster when closer
        const speedMultiplier = 1 + (1 - hashChar.radius / (Math.min(canvas.width, canvas.height) * 0.45)) * 2;
        hashChar.angle += hashChar.speed * speedMultiplier;

        // Calculate position
        hashChar.x = centerRef.current.x + Math.cos(hashChar.angle) * hashChar.radius;
        hashChar.y = centerRef.current.y + Math.sin(hashChar.angle) * hashChar.radius + hashChar.verticalSpeed;

        // Self rotation
        hashChar.rotation += hashChar.rotationSpeed;

        // Brightness increases toward center
        const maxRadius = Math.min(canvas.width, canvas.height) * 0.45;
        hashChar.opacity = 0.3 + (1 - hashChar.radius / maxRadius) * 0.5;

        drawChar(hashChar, opacityMult, time);
      });

      // Draw vortex core on top
      drawVortexCore(opacityMult, time);

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
