/**
 * Falling Leaves Animation
 * Autumn leaves drifting and swaying as they fall
 */

import { useRef, useEffect, useCallback } from 'react';

interface Leaf {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  fallSpeed: number;
  swayAmplitude: number;
  swaySpeed: number;
  swayPhase: number;
  opacity: number;
  variant: number;
  color: { r: number; g: number; b: number };
}

const leafColors = [
  { r: 200, g: 80, b: 40 },
  { r: 220, g: 140, b: 30 },
  { r: 180, g: 60, b: 50 },
  { r: 190, g: 120, b: 40 },
  { r: 160, g: 90, b: 60 },
];

export function useFallingLeaves(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  _darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const leavesRef = useRef<Leaf[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createLeaf = useCallback((canvas: HTMLCanvasElement, startFromTop = true): Leaf => {
    return {
      x: Math.random() * canvas.width,
      y: startFromTop ? -30 : Math.random() * canvas.height,
      size: 12 + Math.random() * 18,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.04,
      fallSpeed: 0.4 + Math.random() * 0.6,
      swayAmplitude: 40 + Math.random() * 60,
      swaySpeed: 0.3 + Math.random() * 0.5,
      swayPhase: Math.random() * Math.PI * 2,
      opacity: 0.4 + Math.random() * 0.4,
      variant: Math.floor(Math.random() * 3),
      color: leafColors[Math.floor(Math.random() * leafColors.length)],
    };
  }, []);

  const drawLeaf = useCallback((
    ctx: CanvasRenderingContext2D,
    leaf: Leaf,
    opacityMultiplier: number
  ) => {
    ctx.save();
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(leaf.rotation);

    const s = leaf.size;
    const alpha = leaf.opacity * opacityMultiplier;
    const { r, g, b } = leaf.color;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;

    switch (leaf.variant) {
      case 0:
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
          const outerR = s * 0.8;
          const innerR = s * 0.35;

          const outerX = Math.cos(angle) * outerR;
          const outerY = Math.sin(angle) * outerR;
          const innerAngle = angle + Math.PI / 5;
          const innerX = Math.cos(innerAngle) * innerR;
          const innerY = Math.sin(innerAngle) * innerR;

          if (i === 0) {
            ctx.moveTo(outerX, outerY);
          } else {
            ctx.lineTo(outerX, outerY);
          }
          ctx.lineTo(innerX, innerY);
        }
        ctx.closePath();
        ctx.fill();
        break;

      case 1:
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.6);
        ctx.bezierCurveTo(s * 0.4, -s * 0.5, s * 0.5, -s * 0.2, s * 0.3, 0);
        ctx.bezierCurveTo(s * 0.5, s * 0.2, s * 0.4, s * 0.5, 0, s * 0.6);
        ctx.bezierCurveTo(-s * 0.4, s * 0.5, -s * 0.5, s * 0.2, -s * 0.3, 0);
        ctx.bezierCurveTo(-s * 0.5, -s * 0.2, -s * 0.4, -s * 0.5, 0, -s * 0.6);
        ctx.fill();
        break;

      case 2:
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.35, s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${r - 30}, ${g - 30}, ${b - 10}, ${alpha * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.5);
        ctx.lineTo(0, s * 0.5);
        ctx.stroke();
        break;
    }

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

    const leafCount = Math.floor((canvas.width * canvas.height) / 30000);
    leavesRef.current = Array.from({ length: Math.max(12, leafCount) }, () =>
      createLeaf(canvas, false)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      leavesRef.current.forEach((leaf, index) => {
        leaf.y += leaf.fallSpeed;

        const sway = Math.sin(timeRef.current * leaf.swaySpeed + leaf.swayPhase);
        leaf.x += sway * 0.5;
        leaf.rotation += leaf.rotationSpeed + sway * 0.01;

        if (leaf.y > canvas.height + 50 || leaf.x < -50 || leaf.x > canvas.width + 50) {
          leavesRef.current[index] = createLeaf(canvas, true);
        }

        drawLeaf(ctx, leaf, opacityMultiplier);
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
  }, [canvasRef, opacity, createLeaf, drawLeaf, active]);
}
