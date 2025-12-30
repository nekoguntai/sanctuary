/**
 * Tidal Patterns Animation
 *
 * Sand ripples with water flowing over them,
 * shells scattered, gentle tide advancing and receding.
 */

import { useEffect, useRef } from 'react';

interface SandRipple {
  y: number;
  amplitude: number;
  frequency: number;
  phase: number;
}

interface Shell {
  x: number;
  y: number;
  type: 'spiral' | 'clam' | 'scallop' | 'starfish';
  size: number;
  rotation: number;
  color: string;
}

interface WaterFoam {
  x: number;
  y: number;
  size: number;
  opacity: number;
  phase: number;
}

interface Sparkle {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

export function useTidalPatterns(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  enabled: boolean
) {
  const ripplesRef = useRef<SandRipple[]>([]);
  const shellsRef = useRef<Shell[]>([]);
  const foamRef = useRef<WaterFoam[]>([]);
  const sparklesRef = useRef<Sparkle[]>([]);
  const animationRef = useRef<number>();
  const timeRef = useRef(0);
  const tidePhaseRef = useRef(0);

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

    // Initialize sand ripples
    ripplesRef.current = [];
    for (let y = 50; y < height; y += 25) {
      ripplesRef.current.push({
        y,
        amplitude: 2 + Math.random() * 3,
        frequency: 0.015 + Math.random() * 0.01,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Initialize shells
    shellsRef.current = [];
    const shellTypes: Shell['type'][] = ['spiral', 'clam', 'scallop', 'starfish'];
    const shellColors = darkMode
      ? ['#d4c4b0', '#c9b89a', '#e0d5c5', '#c5b5a0', '#ddd0c0']
      : ['#f5ebe0', '#ede0d0', '#fff8f0', '#e8ddd0', '#f0e8e0'];

    for (let i = 0; i < 12; i++) {
      shellsRef.current.push({
        x: Math.random() * width,
        y: height * 0.3 + Math.random() * height * 0.6,
        type: shellTypes[Math.floor(Math.random() * shellTypes.length)],
        size: 8 + Math.random() * 12,
        rotation: Math.random() * Math.PI * 2,
        color: shellColors[Math.floor(Math.random() * shellColors.length)],
      });
    }

    foamRef.current = [];
    sparklesRef.current = [];

    const drawShell = (ctx: CanvasRenderingContext2D, shell: Shell) => {
      ctx.save();
      ctx.translate(shell.x, shell.y);
      ctx.rotate(shell.rotation);

      ctx.fillStyle = shell.color;
      ctx.strokeStyle = darkMode ? '#a09080' : '#c0b0a0';
      ctx.lineWidth = 1;

      switch (shell.type) {
        case 'spiral':
          // Snail shell spiral
          ctx.beginPath();
          for (let i = 0; i < 3 * Math.PI; i += 0.1) {
            const r = (shell.size / 3) * (i / Math.PI);
            const x = r * Math.cos(i);
            const y = r * Math.sin(i);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, shell.size * 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;

        case 'clam':
          // Clam shell (two halves)
          ctx.beginPath();
          ctx.ellipse(0, 0, shell.size, shell.size * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Ridges
          for (let i = 0; i < 5; i++) {
            const r = shell.size * (0.3 + i * 0.15);
            ctx.beginPath();
            ctx.arc(0, 0, r, -Math.PI * 0.8, Math.PI * 0.8);
            ctx.stroke();
          }
          break;

        case 'scallop':
          // Scallop shell with ridges
          ctx.beginPath();
          for (let i = 0; i <= 8; i++) {
            const angle = (i / 8) * Math.PI - Math.PI / 2;
            const r = shell.size * (0.8 + Math.sin(i * Math.PI) * 0.2);
            const x = r * Math.cos(angle);
            const y = r * Math.sin(angle) + shell.size * 0.3;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;

        case 'starfish':
          // Five-pointed starfish
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? shell.size : shell.size * 0.4;
            const x = r * Math.cos(angle);
            const y = r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fillStyle = darkMode ? '#d4a080' : '#f0c0a0';
          ctx.fill();
          ctx.stroke();
          break;
      }

      ctx.restore();
    };

    const animate = () => {
      const currentWidth = canvas.getBoundingClientRect().width;
      const currentHeight = canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, currentWidth, currentHeight);
      timeRef.current += 0.016;
      tidePhaseRef.current += 0.008;

      // Calculate tide position (advances and recedes)
      const tideY = currentHeight * 0.3 + Math.sin(tidePhaseRef.current) * currentHeight * 0.15;

      // Sand background gradient
      const sandGradient = ctx.createLinearGradient(0, 0, 0, currentHeight);
      if (darkMode) {
        sandGradient.addColorStop(0, '#3d3528');
        sandGradient.addColorStop(0.3, '#4a4030');
        sandGradient.addColorStop(0.7, '#3a3020');
        sandGradient.addColorStop(1, '#302818');
      } else {
        sandGradient.addColorStop(0, '#f5ebe0');
        sandGradient.addColorStop(0.3, '#ede0d0');
        sandGradient.addColorStop(0.7, '#e5d8c8');
        sandGradient.addColorStop(1, '#ddd0c0');
      }
      ctx.fillStyle = sandGradient;
      ctx.fillRect(0, 0, currentWidth, currentHeight);

      // Draw sand ripples (below water line show through with darkened color)
      ripplesRef.current.forEach((ripple) => {
        ripple.phase += 0.005;

        const isUnderwater = ripple.y < tideY;
        ctx.beginPath();
        ctx.moveTo(0, ripple.y);

        for (let x = 0; x <= currentWidth; x += 5) {
          const y =
            ripple.y +
            Math.sin(x * ripple.frequency + ripple.phase) * ripple.amplitude;
          ctx.lineTo(x, y);
        }

        ctx.strokeStyle = isUnderwater
          ? darkMode
            ? 'rgba(60, 70, 80, 0.3)'
            : 'rgba(100, 120, 140, 0.25)'
          : darkMode
          ? 'rgba(80, 70, 60, 0.4)'
          : 'rgba(180, 160, 140, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Draw shells (partially visible under water)
      shellsRef.current.forEach((shell) => {
        const isUnderwater = shell.y < tideY;
        if (isUnderwater) {
          ctx.globalAlpha = 0.6;
        }
        drawShell(ctx, shell);
        ctx.globalAlpha = 1;
      });

      // Water overlay
      const waterGradient = ctx.createLinearGradient(0, 0, 0, tideY);
      if (darkMode) {
        waterGradient.addColorStop(0, 'rgba(30, 60, 80, 0.7)');
        waterGradient.addColorStop(0.5, 'rgba(40, 70, 90, 0.5)');
        waterGradient.addColorStop(1, 'rgba(50, 80, 100, 0.3)');
      } else {
        waterGradient.addColorStop(0, 'rgba(100, 160, 200, 0.5)');
        waterGradient.addColorStop(0.5, 'rgba(120, 180, 220, 0.35)');
        waterGradient.addColorStop(1, 'rgba(140, 200, 240, 0.2)');
      }
      ctx.fillStyle = waterGradient;
      ctx.fillRect(0, 0, currentWidth, tideY);

      // Water edge with foam
      const foamY = tideY;
      ctx.beginPath();
      ctx.moveTo(0, foamY);

      for (let x = 0; x <= currentWidth; x += 3) {
        const waveOffset =
          Math.sin(x * 0.02 + timeRef.current * 2) * 5 +
          Math.sin(x * 0.05 + timeRef.current * 3) * 2;
        ctx.lineTo(x, foamY + waveOffset);
      }

      ctx.lineTo(currentWidth, foamY - 20);
      ctx.lineTo(0, foamY - 20);
      ctx.closePath();

      // Foam gradient
      const foamGradient = ctx.createLinearGradient(0, foamY - 10, 0, foamY + 10);
      foamGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      foamGradient.addColorStop(0.5, darkMode ? 'rgba(200, 220, 240, 0.6)' : 'rgba(255, 255, 255, 0.7)');
      foamGradient.addColorStop(1, darkMode ? 'rgba(180, 200, 220, 0.3)' : 'rgba(255, 255, 255, 0.4)');
      ctx.fillStyle = foamGradient;
      ctx.fill();

      // Spawn foam bubbles along edge
      if (Math.random() < 0.3) {
        const x = Math.random() * currentWidth;
        foamRef.current.push({
          x,
          y: foamY + Math.sin(x * 0.02 + timeRef.current * 2) * 5,
          size: 2 + Math.random() * 4,
          opacity: 0.5 + Math.random() * 0.3,
          phase: Math.random() * Math.PI * 2,
        });
      }

      // Update and draw foam bubbles
      foamRef.current = foamRef.current.filter((foam) => {
        foam.phase += 0.05;
        foam.opacity -= 0.008;
        foam.y += Math.sin(foam.phase) * 0.3;

        if (foam.opacity <= 0) return false;

        ctx.beginPath();
        ctx.arc(foam.x, foam.y, foam.size, 0, Math.PI * 2);
        ctx.fillStyle = darkMode
          ? `rgba(200, 220, 240, ${foam.opacity})`
          : `rgba(255, 255, 255, ${foam.opacity})`;
        ctx.fill();

        return true;
      });

      // Limit foam
      if (foamRef.current.length > 80) {
        foamRef.current = foamRef.current.slice(-60);
      }

      // Water sparkles (sun reflection)
      if (Math.random() < 0.2) {
        sparklesRef.current.push({
          x: Math.random() * currentWidth,
          y: Math.random() * tideY,
          life: 1,
          maxLife: 1,
        });
      }

      sparklesRef.current = sparklesRef.current.filter((sparkle) => {
        sparkle.life -= 0.03;

        if (sparkle.life <= 0) return false;

        const alpha = sparkle.life * 0.6;
        ctx.beginPath();
        ctx.arc(sparkle.x, sparkle.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();

        return true;
      });

      // Limit sparkles
      if (sparklesRef.current.length > 50) {
        sparklesRef.current = sparklesRef.current.slice(-40);
      }

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
