/**
 * Clover Field Animation (replaces crosshatch)
 *
 * A peaceful field of clovers with occasional lucky four-leaf clovers.
 * Gentle swaying and occasional ladybug visitors.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface Clover {
  x: number;
  y: number;
  size: number;
  leaves: number; // 3 or 4
  phase: number;
  stemAngle: number;
  hue: number;
}

interface Ladybug {
  x: number;
  y: number;
  size: number;
  angle: number;
  speed: number;
  targetX: number;
  targetY: number;
  walkPhase: number;
  dotPositions: { x: number; y: number }[];
}

export function useCloverField(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const cloversRef = useRef<Clover[]>([]);
  const ladybugsRef = useRef<Ladybug[]>([]);
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

      // Create clovers
      cloversRef.current = [];
      const cloverCount = Math.floor((width * height) / 3000);

      for (let i = 0; i < cloverCount; i++) {
        cloversRef.current.push({
          x: Math.random() * width,
          y: height * 0.3 + Math.random() * height * 0.65,
          size: 12 + Math.random() * 12,
          leaves: Math.random() > 0.95 ? 4 : 3, // 5% chance of 4-leaf clover
          phase: Math.random() * Math.PI * 2,
          stemAngle: (Math.random() - 0.5) * 0.3,
          hue: 120 + Math.random() * 30 - 15, // Green variations
        });
      }

      // Create ladybugs
      ladybugsRef.current = [];
      for (let i = 0; i < 3; i++) {
        const dotCount = 4 + Math.floor(Math.random() * 4);
        const dotPositions: { x: number; y: number }[] = [];
        for (let d = 0; d < dotCount; d++) {
          dotPositions.push({
            x: (Math.random() - 0.5) * 0.6,
            y: (Math.random() - 0.5) * 0.7,
          });
        }

        ladybugsRef.current.push({
          x: Math.random() * width,
          y: height * 0.4 + Math.random() * height * 0.5,
          size: 8 + Math.random() * 6,
          angle: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.3,
          targetX: Math.random() * width,
          targetY: height * 0.4 + Math.random() * height * 0.5,
          walkPhase: Math.random() * Math.PI * 2,
          dotPositions,
        });
      }
    };

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      if (darkMode) {
        gradient.addColorStop(0, '#1a2520');
        gradient.addColorStop(0.3, '#1a3025');
        gradient.addColorStop(1, '#0a2010');
      } else {
        gradient.addColorStop(0, '#90EE90');
        gradient.addColorStop(0.3, '#7CCD7C');
        gradient.addColorStop(1, '#5C9C5C');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawClover = (clover: Clover, time: number) => {
      const sway = Math.sin(time * 0.001 + clover.phase) * 0.1;

      ctx.save();
      ctx.translate(clover.x, clover.y);
      ctx.rotate(clover.stemAngle + sway);

      // Stem
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -clover.size * 1.5);
      ctx.strokeStyle = darkMode ? '#2a4a2a' : '#4CAF50';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Leaves
      ctx.translate(0, -clover.size * 1.5);

      for (let l = 0; l < clover.leaves; l++) {
        const angle = (l / clover.leaves) * Math.PI * 2 - Math.PI / 2;

        ctx.save();
        ctx.rotate(angle);
        ctx.translate(clover.size * 0.4, 0);

        // Heart-shaped leaf
        ctx.beginPath();
        ctx.moveTo(0, clover.size * 0.3);
        ctx.bezierCurveTo(
          -clover.size * 0.4, 0,
          -clover.size * 0.3, -clover.size * 0.4,
          0, -clover.size * 0.2
        );
        ctx.bezierCurveTo(
          clover.size * 0.3, -clover.size * 0.4,
          clover.size * 0.4, 0,
          0, clover.size * 0.3
        );

        // Four-leaf clovers get a golden glow
        if (clover.leaves === 4) {
          ctx.fillStyle = darkMode
            ? `hsla(${clover.hue + 20}, 50%, 35%, 0.9)`
            : `hsla(${clover.hue + 20}, 60%, 45%, 0.9)`;
        } else {
          ctx.fillStyle = darkMode
            ? `hsla(${clover.hue}, 40%, 30%, 0.9)`
            : `hsla(${clover.hue}, 50%, 40%, 0.9)`;
        }
        ctx.fill();

        // Leaf vein
        ctx.beginPath();
        ctx.moveTo(0, clover.size * 0.25);
        ctx.lineTo(0, -clover.size * 0.1);
        ctx.strokeStyle = darkMode
          ? 'rgba(60, 100, 60, 0.5)'
          : 'rgba(100, 160, 100, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
      }

      // Golden shimmer for 4-leaf clovers
      if (clover.leaves === 4) {
        const shimmer = Math.sin(time * 0.003 + clover.phase) * 0.3 + 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, clover.size * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 215, 0, ${0.1 * shimmer})`;
        ctx.fill();
      }

      ctx.restore();
    };

    const drawLadybug = (ladybug: Ladybug, time: number) => {
      // Update movement
      const dx = ladybug.targetX - ladybug.x;
      const dy = ladybug.targetY - ladybug.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 20) {
        ladybug.targetX = Math.random() * canvas.width;
        ladybug.targetY = canvas.height * 0.4 + Math.random() * canvas.height * 0.5;
      }

      const targetAngle = Math.atan2(dy, dx);
      let angleDiff = targetAngle - ladybug.angle;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      ladybug.angle += angleDiff * 0.02;

      ladybug.x += Math.cos(ladybug.angle) * ladybug.speed;
      ladybug.y += Math.sin(ladybug.angle) * ladybug.speed;
      ladybug.walkPhase += 0.2;

      ctx.save();
      ctx.translate(ladybug.x, ladybug.y);
      ctx.rotate(ladybug.angle + Math.PI / 2);

      const size = ladybug.size;

      // Body (red shell)
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.7, size, 0, 0, Math.PI * 2);
      ctx.fillStyle = darkMode ? '#8B0000' : '#E53935';
      ctx.fill();

      // Black line down middle
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(0, size);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Black head
      ctx.beginPath();
      ctx.arc(0, -size * 0.9, size * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();

      // Spots
      ctx.fillStyle = '#1a1a1a';
      ladybug.dotPositions.forEach((dot) => {
        ctx.beginPath();
        ctx.arc(dot.x * size, dot.y * size, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
      });

      // Legs (animated)
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      for (let leg = 0; leg < 3; leg++) {
        const legOffset = Math.sin(ladybug.walkPhase + leg * Math.PI / 3) * 2;
        const legY = -size * 0.3 + leg * size * 0.4;

        // Left leg
        ctx.beginPath();
        ctx.moveTo(-size * 0.5, legY);
        ctx.lineTo(-size * 0.9 + legOffset, legY + size * 0.2);
        ctx.stroke();

        // Right leg
        ctx.beginPath();
        ctx.moveTo(size * 0.5, legY);
        ctx.lineTo(size * 0.9 - legOffset, legY + size * 0.2);
        ctx.stroke();
      }

      ctx.restore();
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();

      // Draw clovers (sorted by y for depth)
      const sortedClovers = [...cloversRef.current].sort((a, b) => a.y - b.y);
      sortedClovers.forEach((clover) => drawClover(clover, time));

      // Draw ladybugs
      ladybugsRef.current.forEach((ladybug) => drawLadybug(ladybug, time));

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
