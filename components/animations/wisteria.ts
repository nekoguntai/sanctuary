/**
 * Wisteria Animation
 *
 * Beautiful cascading wisteria flowers hanging from above,
 * gently swaying in the breeze with falling petals.
 */

import { useEffect, useRef } from 'react';

interface WisteriaCluster {
  x: number;
  y: number;
  length: number;
  width: number;
  swayPhase: number;
  swaySpeed: number;
  swayAmount: number;
  color: string;
  bloomPhase: number;
  flowerCount: number;
}

interface FallingPetal {
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  speedX: number;
  speedY: number;
  swayPhase: number;
  swaySpeed: number;
  opacity: number;
}

interface Vine {
  startX: number;
  startY: number;
  controlPoints: { x: number; y: number }[];
  swayPhase: number;
  swaySpeed: number;
}

export function useWisteria(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  enabled: boolean
) {
  const clustersRef = useRef<WisteriaCluster[]>([]);
  const petalsRef = useRef<FallingPetal[]>([]);
  const vinesRef = useRef<Vine[]>([]);
  const animationRef = useRef<number>();
  const timeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

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

    const width = canvas.width;
    const height = canvas.height;

    // Wisteria colors (purples and lavenders)
    const wisteriaColors = darkMode
      ? ['#8060a0', '#7050a0', '#9070b0', '#6050a0', '#a080c0', '#7060b0']
      : ['#b090d0', '#a080c0', '#c0a0e0', '#9080c0', '#d0b0f0', '#a090d0'];

    // Initialize wisteria clusters hanging from top
    clustersRef.current = [];

    // Create hanging points across the top
    const clusterCount = Math.floor(width / 60);
    for (let i = 0; i < clusterCount; i++) {
      const baseX = (i / clusterCount) * width + Math.random() * 40 - 20;

      // Each hanging point has multiple clusters
      const subClusters = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < subClusters; j++) {
        const clusterLength = 80 + Math.random() * 120;
        clustersRef.current.push({
          x: baseX + (Math.random() - 0.5) * 30,
          y: -10 + Math.random() * 20,
          length: clusterLength,
          width: 15 + Math.random() * 10,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: 0.01 + Math.random() * 0.01,
          swayAmount: 8 + Math.random() * 8,
          color: wisteriaColors[Math.floor(Math.random() * wisteriaColors.length)],
          bloomPhase: Math.random() * Math.PI * 2,
          flowerCount: 30 + Math.floor(Math.random() * 20),
        });
      }
    }

    // Initialize vines
    vinesRef.current = [];
    for (let i = 0; i < 8; i++) {
      const startX = Math.random() * width;
      const controlPoints = [];
      let currentY = -20;

      // Create curving vine path
      for (let j = 0; j < 4; j++) {
        currentY += 40 + Math.random() * 60;
        controlPoints.push({
          x: startX + (Math.random() - 0.5) * 100,
          y: currentY,
        });
      }

      vinesRef.current.push({
        startX,
        startY: -20,
        controlPoints,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.008 + Math.random() * 0.005,
      });
    }

    petalsRef.current = [];

    const drawWisteriaCluster = (
      ctx: CanvasRenderingContext2D,
      cluster: WisteriaCluster,
      time: number
    ) => {
      const sway = Math.sin(cluster.swayPhase) * cluster.swayAmount;
      const baseColor = cluster.color;

      // Parse color for variations
      const r = parseInt(baseColor.slice(1, 3), 16);
      const g = parseInt(baseColor.slice(3, 5), 16);
      const b = parseInt(baseColor.slice(5, 7), 16);

      // Draw individual flowers in the cluster
      for (let i = 0; i < cluster.flowerCount; i++) {
        const progress = i / cluster.flowerCount;
        const y = cluster.y + progress * cluster.length;

        // Cluster tapers toward bottom
        const clusterWidthAtY = cluster.width * (1 - progress * 0.6);

        // Flowers get smaller toward bottom
        const flowerSize = (3 + Math.random() * 2) * (1 - progress * 0.5);

        // Horizontal offset with sway
        const swayAtY = sway * progress;
        const xOffset = (Math.random() - 0.5) * clusterWidthAtY * 2;
        const x = cluster.x + xOffset + swayAtY;

        // Color variation (lighter at tips)
        const brightness = 1 + progress * 0.3;
        const flowerR = Math.min(255, r * brightness);
        const flowerG = Math.min(255, g * brightness);
        const flowerB = Math.min(255, b * brightness);

        // Bloom animation (subtle pulsing)
        const bloomScale = 1 + Math.sin(cluster.bloomPhase + progress * Math.PI) * 0.1;

        // Draw flower (simple circular with gradient)
        const gradient = ctx.createRadialGradient(
          x,
          y,
          0,
          x,
          y,
          flowerSize * bloomScale
        );
        gradient.addColorStop(0, `rgba(${flowerR + 30}, ${flowerG + 30}, ${flowerB + 30}, 0.9)`);
        gradient.addColorStop(0.6, `rgba(${flowerR}, ${flowerG}, ${flowerB}, 0.8)`);
        gradient.addColorStop(1, `rgba(${flowerR - 20}, ${flowerG - 20}, ${flowerB}, 0.6)`);

        ctx.beginPath();
        ctx.arc(x, y, flowerSize * bloomScale, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Occasional petal drop
        if (Math.random() < 0.0003) {
          petalsRef.current.push({
            x,
            y,
            size: 2 + Math.random() * 2,
            color: `rgba(${flowerR}, ${flowerG}, ${flowerB}, 0.8)`,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.1,
            speedX: (Math.random() - 0.5) * 0.5,
            speedY: 0.5 + Math.random() * 0.5,
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: 0.05 + Math.random() * 0.03,
            opacity: 1,
          });
        }
      }

      // Draw the stem/support at the top
      ctx.beginPath();
      ctx.moveTo(cluster.x, cluster.y);
      ctx.lineTo(cluster.x + sway * 0.2, cluster.y + 20);
      ctx.strokeStyle = darkMode ? '#4a5040' : '#6a8060';
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    const drawVine = (ctx: CanvasRenderingContext2D, vine: Vine) => {
      const sway = Math.sin(vine.swayPhase) * 15;

      ctx.beginPath();
      ctx.moveTo(vine.startX, vine.startY);

      // Draw curved vine through control points
      for (let i = 0; i < vine.controlPoints.length; i++) {
        const cp = vine.controlPoints[i];
        const swayAtPoint = sway * (i / vine.controlPoints.length);

        if (i === 0) {
          ctx.quadraticCurveTo(
            vine.startX + swayAtPoint,
            (vine.startY + cp.y) / 2,
            cp.x + swayAtPoint,
            cp.y
          );
        } else {
          const prev = vine.controlPoints[i - 1];
          ctx.quadraticCurveTo(
            (prev.x + cp.x) / 2 + swayAtPoint,
            (prev.y + cp.y) / 2,
            cp.x + swayAtPoint,
            cp.y
          );
        }
      }

      ctx.strokeStyle = darkMode ? '#3a4030' : '#5a7050';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Draw leaves along vine
      vine.controlPoints.forEach((cp, i) => {
        const swayAtPoint = sway * (i / vine.controlPoints.length);

        // Small leaves
        ctx.save();
        ctx.translate(cp.x + swayAtPoint, cp.y);
        ctx.rotate(Math.sin(vine.swayPhase + i) * 0.3);

        ctx.beginPath();
        ctx.ellipse(10, 0, 8, 4, 0.3, 0, Math.PI * 2);
        ctx.fillStyle = darkMode ? '#405038' : '#608050';
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(-8, 5, 6, 3, -0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      });
    };

    const animate = () => {
      const currentWidth = canvas.width;
      const currentHeight = canvas.height;
      ctx.clearRect(0, 0, currentWidth, currentHeight);
      timeRef.current += 0.016;

      // Background gradient (soft, ethereal)
      const bgGradient = ctx.createLinearGradient(0, 0, 0, currentHeight);
      if (darkMode) {
        bgGradient.addColorStop(0, '#1a1820');
        bgGradient.addColorStop(0.3, '#201828');
        bgGradient.addColorStop(0.7, '#181520');
        bgGradient.addColorStop(1, '#151318');
      } else {
        bgGradient.addColorStop(0, '#f0e8f8');
        bgGradient.addColorStop(0.3, '#e8e0f0');
        bgGradient.addColorStop(0.7, '#f0e8f0');
        bgGradient.addColorStop(1, '#e8e0e8');
      }
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, currentWidth, currentHeight);

      // Soft light effect from top
      const lightGradient = ctx.createRadialGradient(
        currentWidth * 0.5,
        -100,
        50,
        currentWidth * 0.5,
        currentHeight * 0.3,
        currentHeight * 0.6
      );
      if (darkMode) {
        lightGradient.addColorStop(0, 'rgba(100, 80, 120, 0.1)');
        lightGradient.addColorStop(1, 'rgba(60, 50, 80, 0)');
      } else {
        lightGradient.addColorStop(0, 'rgba(255, 240, 255, 0.3)');
        lightGradient.addColorStop(1, 'rgba(240, 230, 250, 0)');
      }
      ctx.fillStyle = lightGradient;
      ctx.fillRect(0, 0, currentWidth, currentHeight);

      // Draw vines first (behind flowers)
      vinesRef.current.forEach((vine) => {
        vine.swayPhase += vine.swaySpeed;
        drawVine(ctx, vine);
      });

      // Draw wisteria clusters
      clustersRef.current.forEach((cluster) => {
        cluster.swayPhase += cluster.swaySpeed;
        cluster.bloomPhase += 0.005;
        drawWisteriaCluster(ctx, cluster, timeRef.current);
      });

      // Update and draw falling petals
      petalsRef.current = petalsRef.current.filter((petal) => {
        petal.swayPhase += petal.swaySpeed;
        petal.x += petal.speedX + Math.sin(petal.swayPhase) * 0.5;
        petal.y += petal.speedY;
        petal.rotation += petal.rotationSpeed;
        petal.opacity -= 0.002;

        if (petal.y > currentHeight + 20 || petal.opacity <= 0) return false;

        ctx.save();
        ctx.translate(petal.x, petal.y);
        ctx.rotate(petal.rotation);
        ctx.globalAlpha = petal.opacity;

        // Petal shape
        ctx.beginPath();
        ctx.ellipse(0, 0, petal.size, petal.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = petal.color;
        ctx.fill();

        ctx.restore();
        ctx.globalAlpha = 1;

        return true;
      });

      // Limit petals
      if (petalsRef.current.length > 100) {
        petalsRef.current = petalsRef.current.slice(-80);
      }

      // Draw canopy shadow at top (gives depth)
      const canopyGradient = ctx.createLinearGradient(0, 0, 0, 60);
      if (darkMode) {
        canopyGradient.addColorStop(0, 'rgba(20, 25, 30, 0.8)');
        canopyGradient.addColorStop(1, 'rgba(20, 25, 30, 0)');
      } else {
        canopyGradient.addColorStop(0, 'rgba(60, 80, 60, 0.3)');
        canopyGradient.addColorStop(1, 'rgba(60, 80, 60, 0)');
      }
      ctx.fillStyle = canopyGradient;
      ctx.fillRect(0, 0, currentWidth, 60);

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
