/**
 * Still Ponds Animation
 *
 * Serene pond scene with lily pads, ripples, koi fish, and dragonflies.
 * Elements are positioned primarily on the sides, leaving center clear.
 * Optimized for smooth, graceful movement.
 */

import { useEffect, RefObject } from 'react';

interface LilyPad {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  hasFlower: boolean;
  flowerColor: string;
  flowerPhase: number;
  bobPhase: number;
  bobSpeed: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  speed: number;
}

interface Spot {
  x: number;
  y: number;
  size: number;
}

interface KoiFish {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  size: number;
  speed: number;
  angle: number;
  targetAngle: number;
  tailPhase: number;
  color: 'orange' | 'white' | 'gold' | 'red';
  pattern: 'solid' | 'spotted' | 'calico';
  spots: Spot[];
  depth: number;
}

interface Dragonfly {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  wingPhase: number;
  size: number;
  color: string;
  hoverTime: number;
  state: 'flying' | 'hovering';
}

interface WaterPlant {
  x: number;
  y: number;
  height: number;
  segments: number;
  swayPhase: number;
  swaySpeed: number;
  type: 'reed' | 'cattail' | 'grass';
}

export function useStillPonds(
  canvasRef: RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let lilyPads: LilyPad[] = [];
    let ripples: Ripple[] = [];
    let koiFish: KoiFish[] = [];
    let dragonflies: Dragonfly[] = [];
    let waterPlants: WaterPlant[] = [];
    let timeRef = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initializeScene();
    };

    const getRandomSidePosition = (width: number): number => {
      if (Math.random() < 0.7) {
        return Math.random() < 0.5
          ? Math.random() * width * 0.25
          : width * 0.75 + Math.random() * width * 0.25;
      }
      return Math.random() * width;
    };

    const generateSpots = (size: number, pattern: string): Spot[] => {
      if (pattern === 'solid') return [];
      const spots: Spot[] = [];
      const count = pattern === 'calico' ? 5 : 3;
      for (let i = 0; i < count; i++) {
        spots.push({
          x: (Math.random() - 0.3) * size * 0.8,
          y: (Math.random() - 0.5) * size * 0.4,
          size: size * 0.08 + Math.random() * size * 0.08,
        });
      }
      return spots;
    };

    const initializeScene = () => {
      const { width, height } = canvas;

      // Create lily pads
      lilyPads = [];
      const lilyCount = Math.floor(width / 150);
      for (let i = 0; i < lilyCount; i++) {
        lilyPads.push({
          x: getRandomSidePosition(width),
          y: Math.random() * height,
          size: 30 + Math.random() * 40,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.0005,
          hasFlower: Math.random() > 0.6,
          flowerColor: ['#FFB6C1', '#FF69B4', '#FFF0F5', '#FFE4E1'][Math.floor(Math.random() * 4)],
          flowerPhase: Math.random() * Math.PI * 2,
          bobPhase: Math.random() * Math.PI * 2,
          bobSpeed: 0.3 + Math.random() * 0.3,
        });
      }

      // Create koi fish with pre-generated spots
      koiFish = [];
      const fishCount = Math.floor(width / 300);
      for (let i = 0; i < fishCount; i++) {
        const startX = getRandomSidePosition(width);
        const size = 25 + Math.random() * 20;
        const pattern = ['solid', 'spotted', 'calico'][Math.floor(Math.random() * 3)] as KoiFish['pattern'];
        const angle = Math.random() * Math.PI * 2;
        koiFish.push({
          x: startX,
          y: Math.random() * height,
          targetX: getRandomSidePosition(width),
          targetY: Math.random() * height,
          size,
          speed: 0.2 + Math.random() * 0.2,
          angle,
          targetAngle: angle,
          tailPhase: Math.random() * Math.PI * 2,
          color: ['orange', 'white', 'gold', 'red'][Math.floor(Math.random() * 4)] as KoiFish['color'],
          pattern,
          spots: generateSpots(size, pattern),
          depth: 0.3 + Math.random() * 0.5,
        });
      }

      // Create dragonflies
      dragonflies = [];
      const dragonflyCount = Math.floor(width / 500);
      for (let i = 0; i < dragonflyCount; i++) {
        dragonflies.push({
          x: getRandomSidePosition(width),
          y: Math.random() * height * 0.5,
          targetX: getRandomSidePosition(width),
          targetY: Math.random() * height * 0.5,
          wingPhase: Math.random() * Math.PI * 2,
          size: 15 + Math.random() * 10,
          color: ['#4169E1', '#20B2AA', '#9370DB', '#3CB371'][Math.floor(Math.random() * 4)],
          hoverTime: 0,
          state: 'hovering',
        });
      }

      // Create water plants on edges
      waterPlants = [];
      const plantCount = Math.floor(width / 120);
      for (let i = 0; i < plantCount; i++) {
        const edge = Math.random() < 0.5 ? 0 : 1;
        waterPlants.push({
          x: edge === 0 ? Math.random() * width * 0.12 : width * 0.88 + Math.random() * width * 0.12,
          y: height,
          height: 80 + Math.random() * 120,
          segments: 4 + Math.floor(Math.random() * 4),
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: 0.3 + Math.random() * 0.3,
          type: ['reed', 'cattail', 'grass'][Math.floor(Math.random() * 3)] as WaterPlant['type'],
        });
      }

      ripples = [];
    };

    const drawWaterBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const waterGradient = ctx.createLinearGradient(0, 0, 0, height);
      if (darkMode) {
        waterGradient.addColorStop(0, '#1a3a4a');
        waterGradient.addColorStop(0.5, '#0d2a35');
        waterGradient.addColorStop(1, '#051520');
      } else {
        waterGradient.addColorStop(0, '#87CEEB');
        waterGradient.addColorStop(0.5, '#5BA3C0');
        waterGradient.addColorStop(1, '#3A7D9A');
      }
      ctx.fillStyle = waterGradient;
      ctx.fillRect(0, 0, width, height);

      // Subtle water caustics - slower movement
      ctx.globalAlpha = 0.03;
      for (let i = 0; i < 15; i++) {
        const x = (Math.sin(timeRef * 0.0001 + i * 0.7) * 0.5 + 0.5) * width;
        const y = (Math.cos(timeRef * 0.00008 + i * 0.5) * 0.5 + 0.5) * height;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 120);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - 120, y - 120, 240, 240);
      }
      ctx.globalAlpha = 1;
    };

    const drawLilyPad = (ctx: CanvasRenderingContext2D, pad: LilyPad) => {
      const bobOffset = Math.sin(timeRef * 0.0005 * pad.bobSpeed + pad.bobPhase) * 1.5;

      ctx.save();
      ctx.translate(pad.x, pad.y + bobOffset);
      ctx.rotate(pad.rotation);

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.beginPath();
      ctx.ellipse(2, 2, pad.size, pad.size * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();

      // Main lily pad
      const padGradient = ctx.createRadialGradient(
        -pad.size * 0.3, -pad.size * 0.3, 0,
        0, 0, pad.size
      );
      padGradient.addColorStop(0, darkMode ? '#2d5a3a' : '#4CAF50');
      padGradient.addColorStop(0.5, darkMode ? '#1e4a2a' : '#388E3C');
      padGradient.addColorStop(1, darkMode ? '#153a20' : '#2E7D32');

      ctx.fillStyle = padGradient;
      ctx.beginPath();
      ctx.ellipse(0, 0, pad.size, pad.size * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();

      // Notch
      ctx.fillStyle = darkMode ? '#0d2a35' : '#5BA3C0';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(pad.size * 0.3, -pad.size * 0.1);
      ctx.lineTo(pad.size, 0);
      ctx.lineTo(pad.size * 0.3, pad.size * 0.1);
      ctx.closePath();
      ctx.fill();

      // Veins
      ctx.strokeStyle = darkMode ? 'rgba(100, 180, 100, 0.2)' : 'rgba(200, 230, 200, 0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        if (Math.abs(angle) > 0.3) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(angle) * pad.size * 0.8, Math.sin(angle) * pad.size * 0.7);
          ctx.stroke();
        }
      }

      // Lotus flower
      if (pad.hasFlower) {
        const flowerBob = Math.sin(timeRef * 0.0008 + pad.flowerPhase) * 0.5;
        const petalCount = 8;
        const petalLength = pad.size * 0.4;
        const openAmount = 0.85 + Math.sin(timeRef * 0.0002 + pad.flowerPhase) * 0.05;

        for (let i = 0; i < petalCount; i++) {
          const angle = (i / petalCount) * Math.PI * 2;

          ctx.save();
          ctx.translate(0, -5 + flowerBob);
          ctx.rotate(angle);

          const petalGradient = ctx.createLinearGradient(0, 0, petalLength, 0);
          petalGradient.addColorStop(0, '#FFF8DC');
          petalGradient.addColorStop(0.5, pad.flowerColor);
          petalGradient.addColorStop(1, pad.flowerColor);

          ctx.fillStyle = petalGradient;
          ctx.beginPath();
          ctx.ellipse(petalLength * 0.5 * openAmount, 0, petalLength * 0.5, petalLength * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }

        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(0, -5 + flowerBob, pad.size * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const drawKoiFish = (ctx: CanvasRenderingContext2D, fish: KoiFish) => {
      ctx.save();
      ctx.translate(fish.x, fish.y);
      ctx.rotate(fish.angle);

      ctx.globalAlpha = 0.5 + fish.depth * 0.5;

      const size = fish.size;
      // Smooth, slow tail movement
      const tailWag = Math.sin(timeRef * 0.003 + fish.tailPhase) * 0.25;

      let bodyColor: string, spotColor: string;
      switch (fish.color) {
        case 'orange':
          bodyColor = '#FF6B35';
          spotColor = '#FFFFFF';
          break;
        case 'white':
          bodyColor = '#FFFAF0';
          spotColor = '#FF6B35';
          break;
        case 'gold':
          bodyColor = '#FFD700';
          spotColor = '#FF8C00';
          break;
        case 'red':
          bodyColor = '#DC143C';
          spotColor = '#FFFFFF';
          break;
      }

      // Shadow
      ctx.fillStyle = `rgba(0, 0, 0, ${0.08 * fish.depth})`;
      ctx.beginPath();
      ctx.ellipse(0, 5, size * 0.7, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tail - smooth flowing curves
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, 0);
      ctx.bezierCurveTo(
        -size * 0.7, tailWag * size * 0.3,
        -size * 0.9, tailWag * size * 0.5,
        -size * 1.1, tailWag * size * 0.6 - size * 0.25
      );
      ctx.bezierCurveTo(
        -size * 0.85, tailWag * size * 0.2,
        -size * 0.85, tailWag * size * 0.2,
        -size * 1.1, tailWag * size * 0.6 + size * 0.25
      );
      ctx.bezierCurveTo(
        -size * 0.9, tailWag * size * 0.5,
        -size * 0.7, tailWag * size * 0.3,
        -size * 0.5, 0
      );
      ctx.fill();

      // Body
      const bodyGradient = ctx.createRadialGradient(
        size * 0.15, -size * 0.08, 0,
        0, 0, size * 0.75
      );
      bodyGradient.addColorStop(0, '#FFFFFF');
      bodyGradient.addColorStop(0.25, bodyColor);
      bodyGradient.addColorStop(1, bodyColor);

      ctx.fillStyle = bodyGradient;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.65, size * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pre-generated spots (no flickering)
      if (fish.spots.length > 0) {
        ctx.fillStyle = spotColor;
        fish.spots.forEach(spot => {
          ctx.beginPath();
          ctx.arc(spot.x, spot.y, spot.size, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Dorsal fin
      ctx.fillStyle = bodyColor;
      ctx.globalAlpha *= 0.85;
      ctx.beginPath();
      ctx.moveTo(size * 0.1, -size * 0.32);
      ctx.quadraticCurveTo(0, -size * 0.55, -size * 0.15, -size * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.5 + fish.depth * 0.5;

      // Pectoral fins
      const finWave = Math.sin(timeRef * 0.002 + fish.tailPhase) * 0.1;
      ctx.beginPath();
      ctx.ellipse(size * 0.15, size * 0.22, size * 0.18, size * 0.07, Math.PI * 0.15 + finWave, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(size * 0.15, -size * 0.22, size * 0.18, size * 0.07, -Math.PI * 0.15 - finWave, 0, Math.PI * 2);
      ctx.fill();

      // Eye
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(size * 0.38, -size * 0.04, size * 0.055, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(size * 0.4, -size * 0.055, size * 0.018, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const drawDragonfly = (ctx: CanvasRenderingContext2D, dragonfly: Dragonfly) => {
      ctx.save();
      ctx.translate(dragonfly.x, dragonfly.y);

      const size = dragonfly.size;
      const wingFlap = Math.sin(timeRef * 0.015 + dragonfly.wingPhase);

      const dx = dragonfly.targetX - dragonfly.x;
      const dy = dragonfly.targetY - dragonfly.y;
      const angle = Math.atan2(dy, dx);
      ctx.rotate(angle);

      ctx.fillStyle = 'rgba(200, 220, 255, 0.35)';
      ctx.strokeStyle = 'rgba(100, 150, 200, 0.5)';
      ctx.lineWidth = 0.5;

      const wingAngle = wingFlap * 0.25;

      // Wings
      ctx.save();
      ctx.rotate(wingAngle);
      ctx.beginPath();
      ctx.ellipse(-size * 0.3, -size * 0.8, size * 0.15, size * 0.6, -Math.PI * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(-wingAngle);
      ctx.beginPath();
      ctx.ellipse(-size * 0.3, size * 0.8, size * 0.15, size * 0.6, Math.PI * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(wingAngle * 0.8);
      ctx.beginPath();
      ctx.ellipse(-size * 0.5, -size * 0.5, size * 0.1, size * 0.4, -Math.PI * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(-wingAngle * 0.8);
      ctx.beginPath();
      ctx.ellipse(-size * 0.5, size * 0.5, size * 0.1, size * 0.4, Math.PI * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Body
      const bodyGradient = ctx.createLinearGradient(-size, 0, size * 0.5, 0);
      bodyGradient.addColorStop(0, dragonfly.color);
      bodyGradient.addColorStop(1, '#000000');
      ctx.fillStyle = bodyGradient;

      for (let i = 0; i < 6; i++) {
        const segX = -size * 0.2 - i * size * 0.2;
        const segSize = size * 0.08 * (1 - i * 0.1);
        ctx.beginPath();
        ctx.ellipse(segX, 0, segSize * 1.5, segSize, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.15, size * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = dragonfly.color;
      ctx.beginPath();
      ctx.arc(size * 0.2, 0, size * 0.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#2F4F4F';
      ctx.beginPath();
      ctx.arc(size * 0.25, -size * 0.05, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(size * 0.25, size * 0.05, size * 0.06, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const drawWaterPlant = (ctx: CanvasRenderingContext2D, plant: WaterPlant) => {
      ctx.save();
      ctx.translate(plant.x, plant.y);

      const sway = Math.sin(timeRef * 0.0005 * plant.swaySpeed + plant.swayPhase) * 8;

      if (plant.type === 'reed' || plant.type === 'cattail') {
        ctx.strokeStyle = darkMode ? '#2d4a3a' : '#4a6741';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);

        let currentX = 0;
        let currentY = 0;
        const segmentHeight = plant.height / plant.segments;

        for (let i = 0; i < plant.segments; i++) {
          const swayAmount = sway * (i / plant.segments);
          currentX += swayAmount / plant.segments;
          currentY -= segmentHeight;
          ctx.lineTo(currentX, currentY);
        }
        ctx.stroke();

        if (plant.type === 'cattail') {
          ctx.fillStyle = darkMode ? '#4a3a2a' : '#8B4513';
          ctx.beginPath();
          ctx.ellipse(currentX, currentY - 15, 6, 20, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = darkMode ? '#1e3a2a' : '#3a5a31';
        for (let i = 1; i < plant.segments; i++) {
          const leafY = -segmentHeight * i;
          const leafSway = sway * (i / plant.segments);
          const leafDir = i % 2 === 0 ? 1 : -1;

          ctx.beginPath();
          ctx.moveTo(leafSway * (i / plant.segments), leafY);
          ctx.quadraticCurveTo(
            leafDir * 20 + leafSway,
            leafY - 20,
            leafDir * 30 + leafSway * 1.5,
            leafY - 10
          );
          ctx.quadraticCurveTo(
            leafDir * 20 + leafSway,
            leafY - 5,
            leafSway * (i / plant.segments),
            leafY
          );
          ctx.fill();
        }
      } else {
        for (let i = 0; i < 5; i++) {
          const grassSway = sway * (0.8 + i * 0.05);
          const grassHeight = plant.height * (0.6 + i * 0.08);
          const grassX = (i - 2) * 5;

          ctx.strokeStyle = darkMode ? '#2d4a3a' : '#4a6741';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(grassX, 0);
          ctx.quadraticCurveTo(
            grassX + grassSway * 0.5,
            -grassHeight * 0.5,
            grassX + grassSway,
            -grassHeight
          );
          ctx.stroke();
        }
      }

      ctx.restore();
    };

    const drawRipple = (ctx: CanvasRenderingContext2D, ripple: Ripple) => {
      ctx.strokeStyle = darkMode
        ? `rgba(150, 200, 220, ${ripple.opacity})`
        : `rgba(255, 255, 255, ${ripple.opacity})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
      ctx.stroke();
    };

    const updateFish = (fish: KoiFish) => {
      const dx = fish.targetX - fish.x;
      const dy = fish.targetY - fish.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 30) {
        fish.targetX = getRandomSidePosition(canvas.width);
        fish.targetY = Math.random() * canvas.height;
      } else {
        // Smooth movement with easing
        fish.x += (dx / dist) * fish.speed;
        fish.y += (dy / dist) * fish.speed;

        // Smooth angle transition
        fish.targetAngle = Math.atan2(dy, dx);
        const angleDiff = fish.targetAngle - fish.angle;
        // Normalize angle difference
        const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        fish.angle += normalizedDiff * 0.03; // Smooth turning
      }

      fish.tailPhase += 0.02;
    };

    const updateDragonfly = (df: Dragonfly) => {
      const dx = df.targetX - df.x;
      const dy = df.targetY - df.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (df.state === 'flying') {
        if (dist < 15) {
          df.state = 'hovering';
          df.hoverTime = 120 + Math.random() * 180;
        } else {
          df.x += (dx / dist) * 1.2;
          df.y += (dy / dist) * 1.2;
        }
      } else {
        df.hoverTime--;
        df.x += Math.sin(timeRef * 0.005) * 0.15;
        df.y += Math.cos(timeRef * 0.007) * 0.1;

        if (df.hoverTime <= 0) {
          df.state = 'flying';
          df.targetX = getRandomSidePosition(canvas.width);
          df.targetY = Math.random() * canvas.height * 0.5;
        }
      }

      df.wingPhase += 0.1;
    };

    const animate = () => {
      const { width, height } = canvas;
      timeRef++;

      ctx.clearRect(0, 0, width, height);

      drawWaterBackground(ctx, width, height);

      // Ripples - less frequent
      if (Math.random() < 0.005) {
        ripples.push({
          x: getRandomSidePosition(width),
          y: Math.random() * height,
          radius: 0,
          maxRadius: 25 + Math.random() * 30,
          opacity: 0.4,
          speed: 0.3 + Math.random() * 0.3,
        });
      }

      ripples = ripples.filter(r => {
        r.radius += r.speed;
        r.opacity = 0.4 * (1 - r.radius / r.maxRadius);
        drawRipple(ctx, r);
        return r.radius < r.maxRadius;
      });

      // Fish
      koiFish.sort((a, b) => a.depth - b.depth);
      koiFish.forEach(fish => {
        updateFish(fish);
        drawKoiFish(ctx, fish);
      });

      // Lily pads
      lilyPads.forEach(pad => {
        pad.rotation += pad.rotationSpeed;
        drawLilyPad(ctx, pad);
      });

      // Plants
      waterPlants.forEach(plant => drawWaterPlant(ctx, plant));

      // Dragonflies
      dragonflies.forEach(df => {
        updateDragonfly(df);
        drawDragonfly(ctx, df);
      });

      animationId = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [canvasRef, darkMode, opacity, active]);
}
