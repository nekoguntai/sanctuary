/**
 * Soap Bubbles Animation
 *
 * Gentle iridescent soap bubbles floating upward with beautiful
 * rainbow reflections and occasional subtle pops.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface Bubble {
  x: number;
  y: number;
  size: number;
  speed: number;
  wobblePhase: number;
  wobbleSpeed: number;
  wobbleAmount: number;
  hueShift: number;
  opacity: number;
  highlightAngle: number;
}

interface PopParticle {
  x: number;
  y: number;
  angle: number;
  speed: number;
  life: number;
  size: number;
}

export function useSoapBubbles(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const bubblesRef = useRef<Bubble[]>([]);
  const particlesRef = useRef<PopParticle[]>([]);
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

      // Create bubbles
      bubblesRef.current = [];
      const count = Math.floor(width / 100) + 5;

      for (let i = 0; i < count; i++) {
        bubblesRef.current.push(createBubble(width, height, true));
      }

      particlesRef.current = [];
    };

    const createBubble = (width: number, height: number, randomY: boolean): Bubble => ({
      x: Math.random() * width,
      y: randomY ? Math.random() * height : height + 50 + Math.random() * 100,
      size: 20 + Math.random() * 40,
      speed: 0.3 + Math.random() * 0.4,
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.01 + Math.random() * 0.01,
      wobbleAmount: 0.5 + Math.random() * 1,
      hueShift: Math.random() * 360,
      opacity: 0.3 + Math.random() * 0.3,
      highlightAngle: Math.random() * Math.PI * 2,
    });

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      if (darkMode) {
        gradient.addColorStop(0, '#0a1520');
        gradient.addColorStop(0.5, '#152030');
        gradient.addColorStop(1, '#0a1525');
      } else {
        gradient.addColorStop(0, '#E8F4FC');
        gradient.addColorStop(0.5, '#D0E8F8');
        gradient.addColorStop(1, '#C0E0F4');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawBubble = (bubble: Bubble, time: number) => {
      // Update position
      bubble.y -= bubble.speed;
      bubble.wobblePhase += bubble.wobbleSpeed;
      bubble.x += Math.sin(bubble.wobblePhase) * bubble.wobbleAmount;

      // Reset if off screen (with small chance to pop instead)
      if (bubble.y < -bubble.size * 2) {
        if (Math.random() > 0.7) {
          // Create pop particles
          for (let i = 0; i < 6; i++) {
            particlesRef.current.push({
              x: bubble.x,
              y: bubble.y + bubble.size,
              angle: (i / 6) * Math.PI * 2,
              speed: 1 + Math.random() * 2,
              life: 30,
              size: 2 + Math.random() * 3,
            });
          }
        }
        Object.assign(bubble, createBubble(canvas.width, canvas.height, false));
        return;
      }

      const { x, y, size } = bubble;

      // Iridescent bubble body
      const bubbleGradient = ctx.createRadialGradient(
        x - size * 0.3,
        y - size * 0.3,
        0,
        x,
        y,
        size
      );

      // Create iridescent colors
      const hue1 = (bubble.hueShift + time * 0.01) % 360;
      const hue2 = (hue1 + 60) % 360;
      const hue3 = (hue1 + 180) % 360;

      bubbleGradient.addColorStop(0, `hsla(${hue1}, 70%, 85%, ${bubble.opacity * 0.3})`);
      bubbleGradient.addColorStop(0.3, `hsla(${hue2}, 60%, 75%, ${bubble.opacity * 0.2})`);
      bubbleGradient.addColorStop(0.6, `hsla(${hue3}, 50%, 70%, ${bubble.opacity * 0.15})`);
      bubbleGradient.addColorStop(1, `hsla(${hue1}, 40%, 60%, ${bubble.opacity * 0.05})`);

      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = bubbleGradient;
      ctx.fill();

      // Bubble edge
      ctx.strokeStyle = darkMode
        ? `rgba(180, 200, 220, ${bubble.opacity * 0.4})`
        : `rgba(255, 255, 255, ${bubble.opacity * 0.6})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Main highlight
      const highlightX = x - size * 0.35;
      const highlightY = y - size * 0.35;
      const highlightGradient = ctx.createRadialGradient(
        highlightX,
        highlightY,
        0,
        highlightX,
        highlightY,
        size * 0.4
      );
      highlightGradient.addColorStop(0, `rgba(255, 255, 255, ${bubble.opacity * 0.8})`);
      highlightGradient.addColorStop(0.5, `rgba(255, 255, 255, ${bubble.opacity * 0.3})`);
      highlightGradient.addColorStop(1, 'transparent');

      ctx.beginPath();
      ctx.arc(highlightX, highlightY, size * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = highlightGradient;
      ctx.fill();

      // Secondary small highlight
      const highlight2X = x + size * 0.25;
      const highlight2Y = y + size * 0.25;
      ctx.beginPath();
      ctx.arc(highlight2X, highlight2Y, size * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${bubble.opacity * 0.5})`;
      ctx.fill();

      // Rainbow arc on edge
      const arcGradient = ctx.createLinearGradient(
        x - size,
        y - size * 0.5,
        x + size,
        y + size * 0.5
      );
      arcGradient.addColorStop(0, `hsla(${hue1}, 80%, 70%, ${bubble.opacity * 0.3})`);
      arcGradient.addColorStop(0.25, `hsla(${hue1 + 30}, 80%, 70%, ${bubble.opacity * 0.3})`);
      arcGradient.addColorStop(0.5, `hsla(${hue1 + 60}, 80%, 70%, ${bubble.opacity * 0.3})`);
      arcGradient.addColorStop(0.75, `hsla(${hue1 + 90}, 80%, 70%, ${bubble.opacity * 0.3})`);
      arcGradient.addColorStop(1, `hsla(${hue1 + 120}, 80%, 70%, ${bubble.opacity * 0.3})`);

      ctx.beginPath();
      ctx.arc(x, y, size * 0.85, Math.PI * 0.8, Math.PI * 1.4);
      ctx.strokeStyle = arcGradient;
      ctx.lineWidth = size * 0.08;
      ctx.stroke();
    };

    const drawParticles = () => {
      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.x += Math.cos(particle.angle) * particle.speed;
        particle.y += Math.sin(particle.angle) * particle.speed;
        particle.life -= 1;
        particle.speed *= 0.95;

        if (particle.life <= 0) return false;

        const alpha = particle.life / 30;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
        ctx.fillStyle = darkMode
          ? `rgba(150, 180, 200, ${alpha * 0.5})`
          : `rgba(255, 255, 255, ${alpha * 0.7})`;
        ctx.fill();

        return true;
      });
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();

      // Occasionally add new bubble
      if (Math.random() > 0.98 && bubblesRef.current.length < 20) {
        bubblesRef.current.push(createBubble(canvas.width, canvas.height, false));
      }

      // Draw bubbles (sorted by size for depth)
      bubblesRef.current
        .sort((a, b) => a.size - b.size)
        .forEach((bubble) => drawBubble(bubble, time));

      drawParticles();

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
