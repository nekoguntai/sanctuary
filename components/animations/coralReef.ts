/**
 * Coral Reef Animation
 *
 * Vibrant underwater scene with colorful coral, tropical fish,
 * swaying sea plants, and gentle light rays. Elements on sides.
 */

import { useEffect, RefObject } from 'react';

interface Coral {
  x: number;
  y: number;
  type: 'brain' | 'branching' | 'fan' | 'tube' | 'mushroom';
  size: number;
  color: string;
  swayPhase: number;
}

interface Fish {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  size: number;
  speed: number;
  type: 'clown' | 'tang' | 'angel' | 'butterfly' | 'nemo';
  direction: 1 | -1;
  tailPhase: number;
  depth: number;
}

interface SeaPlant {
  x: number;
  y: number;
  height: number;
  segments: number;
  color: string;
  swayPhase: number;
  swaySpeed: number;
}

interface Bubble {
  x: number;
  y: number;
  size: number;
  speed: number;
  wobble: number;
}

interface LightRay {
  x: number;
  width: number;
  opacity: number;
  speed: number;
}

interface Starfish {
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
}

interface Jellyfish {
  x: number;
  y: number;
  size: number;
  pulsePhase: number;
  tentaclePhase: number;
  color: string;
  direction: 1 | -1;
}

export function useCoralReef(
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
    let corals: Coral[] = [];
    let fish: Fish[] = [];
    let seaPlants: SeaPlant[] = [];
    let bubbles: Bubble[] = [];
    let lightRays: LightRay[] = [];
    let starfish: Starfish[] = [];
    let jellyfish: Jellyfish[] = [];
    let timeRef = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initializeScene();
    };

    const getRandomSidePosition = (width: number): number => {
      if (Math.random() < 0.75) {
        return Math.random() < 0.5
          ? Math.random() * width * 0.25
          : width * 0.75 + Math.random() * width * 0.25;
      }
      return Math.random() * width;
    };

    const initializeScene = () => {
      const { width, height } = canvas;

      // Create corals
      corals = [];
      const coralCount = Math.floor(width / 100);
      const coralTypes: Coral['type'][] = ['brain', 'branching', 'fan', 'tube', 'mushroom'];
      const coralColors = ['#FF6B6B', '#FF8E53', '#FFD93D', '#6BCB77', '#4D96FF', '#9B59B6', '#E056FD'];

      for (let i = 0; i < coralCount; i++) {
        corals.push({
          x: getRandomSidePosition(width),
          y: height * 0.7 + Math.random() * height * 0.25,
          type: coralTypes[Math.floor(Math.random() * coralTypes.length)],
          size: 30 + Math.random() * 40,
          color: coralColors[Math.floor(Math.random() * coralColors.length)],
          swayPhase: Math.random() * Math.PI * 2,
        });
      }

      // Create fish
      fish = [];
      const fishCount = Math.ceil(width / 200);
      const fishTypes: Fish['type'][] = ['clown', 'tang', 'angel', 'butterfly', 'nemo'];

      for (let i = 0; i < fishCount; i++) {
        const startX = getRandomSidePosition(width);
        fish.push({
          x: startX,
          y: height * 0.2 + Math.random() * height * 0.5,
          targetX: getRandomSidePosition(width),
          targetY: height * 0.2 + Math.random() * height * 0.5,
          size: 15 + Math.random() * 20,
          speed: 0.5 + Math.random() * 1,
          type: fishTypes[Math.floor(Math.random() * fishTypes.length)],
          direction: 1,
          tailPhase: Math.random() * Math.PI * 2,
          depth: 0.4 + Math.random() * 0.6,
        });
      }

      // Create sea plants
      seaPlants = [];
      const plantCount = Math.floor(width / 80);
      const plantColors = ['#228B22', '#32CD32', '#3CB371', '#2E8B57', '#98FB98'];

      for (let i = 0; i < plantCount; i++) {
        seaPlants.push({
          x: getRandomSidePosition(width),
          y: height,
          height: 60 + Math.random() * 100,
          segments: 5 + Math.floor(Math.random() * 5),
          color: plantColors[Math.floor(Math.random() * plantColors.length)],
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: 0.5 + Math.random() * 0.5,
        });
      }

      // Create light rays
      lightRays = [];
      for (let i = 0; i < 5; i++) {
        lightRays.push({
          x: Math.random() * width,
          width: 30 + Math.random() * 50,
          opacity: 0.05 + Math.random() * 0.1,
          speed: 0.2 + Math.random() * 0.3,
        });
      }

      // Create starfish
      starfish = [];
      const starfishCount = Math.floor(width / 300);
      for (let i = 0; i < starfishCount; i++) {
        starfish.push({
          x: getRandomSidePosition(width),
          y: height * 0.85 + Math.random() * height * 0.1,
          size: 15 + Math.random() * 15,
          rotation: Math.random() * Math.PI * 2,
          color: ['#FF6347', '#FF8C00', '#FFD700', '#FF69B4'][Math.floor(Math.random() * 4)],
        });
      }

      // Create jellyfish
      jellyfish = [];
      for (let i = 0; i < 2; i++) {
        jellyfish.push({
          x: getRandomSidePosition(width),
          y: height * 0.3 + Math.random() * height * 0.3,
          size: 25 + Math.random() * 25,
          pulsePhase: Math.random() * Math.PI * 2,
          tentaclePhase: Math.random() * Math.PI * 2,
          color: ['rgba(255, 182, 193, 0.6)', 'rgba(173, 216, 230, 0.6)', 'rgba(221, 160, 221, 0.6)'][Math.floor(Math.random() * 3)],
          direction: Math.random() < 0.5 ? 1 : -1,
        });
      }

      bubbles = [];
    };

    const drawBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      // Deep ocean gradient
      const waterGradient = ctx.createLinearGradient(0, 0, 0, height);
      if (darkMode) {
        waterGradient.addColorStop(0, '#051525');
        waterGradient.addColorStop(0.3, '#082535');
        waterGradient.addColorStop(0.6, '#0a3545');
        waterGradient.addColorStop(1, '#0d4555');
      } else {
        waterGradient.addColorStop(0, '#00CED1');
        waterGradient.addColorStop(0.3, '#20B2AA');
        waterGradient.addColorStop(0.6, '#008B8B');
        waterGradient.addColorStop(1, '#006666');
      }
      ctx.fillStyle = waterGradient;
      ctx.fillRect(0, 0, width, height);

      // Sandy bottom
      const sandGradient = ctx.createLinearGradient(0, height * 0.85, 0, height);
      sandGradient.addColorStop(0, 'transparent');
      sandGradient.addColorStop(0.3, darkMode ? '#2a3a3a' : '#F4D03F');
      sandGradient.addColorStop(1, darkMode ? '#3a4a4a' : '#DAA520');
      ctx.fillStyle = sandGradient;
      ctx.fillRect(0, height * 0.85, width, height * 0.15);
    };

    const drawLightRay = (ctx: CanvasRenderingContext2D, ray: LightRay, height: number) => {
      const gradient = ctx.createLinearGradient(ray.x, 0, ray.x + ray.width, height);
      gradient.addColorStop(0, `rgba(255, 255, 200, ${ray.opacity})`);
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(ray.x, 0);
      ctx.lineTo(ray.x + ray.width * 0.3, 0);
      ctx.lineTo(ray.x + ray.width, height);
      ctx.lineTo(ray.x + ray.width * 0.7, height);
      ctx.closePath();
      ctx.fill();
    };

    const drawCoral = (ctx: CanvasRenderingContext2D, coral: Coral) => {
      const sway = Math.sin(timeRef * 0.002 + coral.swayPhase) * 3;

      ctx.save();
      ctx.translate(coral.x, coral.y);

      const size = coral.size;

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      ctx.ellipse(3, 3, size * 0.4, size * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();

      switch (coral.type) {
        case 'brain':
          // Brain coral - round with wavy lines
          const brainGradient = ctx.createRadialGradient(
            -size * 0.2, -size * 0.3, 0,
            0, 0, size * 0.5
          );
          brainGradient.addColorStop(0, coral.color);
          brainGradient.addColorStop(1, darkMode ? '#333' : '#666');

          ctx.fillStyle = brainGradient;
          ctx.beginPath();
          ctx.arc(0, -size * 0.2, size * 0.4, 0, Math.PI * 2);
          ctx.fill();

          // Wavy pattern
          ctx.strokeStyle = darkMode ? '#222' : '#444';
          ctx.lineWidth = 1;
          for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            for (let a = 0; a < Math.PI * 2; a += 0.1) {
              const r = size * 0.3 - i * 4;
              const wave = Math.sin(a * 3 + i) * 2;
              const px = Math.cos(a) * (r + wave);
              const py = Math.sin(a) * (r + wave) - size * 0.2;
              if (a === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          break;

        case 'branching':
          // Branching coral
          const branchColor = coral.color;

          const drawBranch = (x: number, y: number, angle: number, length: number, depth: number) => {
            if (depth <= 0 || length < 5) return;

            const endX = x + Math.cos(angle) * length;
            const endY = y + Math.sin(angle) * length;

            ctx.strokeStyle = branchColor;
            ctx.lineWidth = depth * 2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(endX + sway * (4 - depth) * 0.2, endY);
            ctx.stroke();

            // Polyps
            if (depth <= 2) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
              ctx.beginPath();
              ctx.arc(endX, endY, 3, 0, Math.PI * 2);
              ctx.fill();
            }

            drawBranch(endX, endY, angle - 0.5, length * 0.7, depth - 1);
            drawBranch(endX, endY, angle + 0.5, length * 0.7, depth - 1);
          };

          drawBranch(0, 0, -Math.PI / 2, size * 0.5, 4);
          break;

        case 'fan':
          // Sea fan coral
          ctx.strokeStyle = coral.color;
          for (let i = 0; i < 15; i++) {
            const angle = -Math.PI * 0.3 + (i / 14) * Math.PI * 0.6;
            const fanSway = sway * 0.02;

            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(
              Math.cos(angle + fanSway) * size * 0.3,
              Math.sin(angle + fanSway) * size * 0.3 - size * 0.2,
              Math.cos(angle + fanSway) * size * 0.6,
              Math.sin(angle + fanSway) * size * 0.6 - size * 0.4
            );
            ctx.stroke();
          }

          // Cross hatching
          ctx.strokeStyle = `${coral.color}88`;
          ctx.lineWidth = 0.5;
          for (let i = 0; i < 8; i++) {
            const y = -size * 0.1 - i * size * 0.05;
            ctx.beginPath();
            ctx.moveTo(-size * 0.3, y);
            ctx.lineTo(size * 0.3, y);
            ctx.stroke();
          }
          break;

        case 'tube':
          // Tube coral
          for (let i = 0; i < 5; i++) {
            const tubeX = (i - 2) * size * 0.2;
            const tubeHeight = size * 0.5 + Math.random() * size * 0.3;

            const tubeGradient = ctx.createLinearGradient(tubeX - 5, 0, tubeX + 5, 0);
            tubeGradient.addColorStop(0, coral.color);
            tubeGradient.addColorStop(0.5, darkMode ? coral.color : '#FFF');
            tubeGradient.addColorStop(1, coral.color);

            ctx.fillStyle = tubeGradient;
            ctx.beginPath();
            ctx.moveTo(tubeX - 8, 0);
            ctx.lineTo(tubeX - 6, -tubeHeight + sway);
            ctx.quadraticCurveTo(tubeX, -tubeHeight - 5 + sway, tubeX + 6, -tubeHeight + sway);
            ctx.lineTo(tubeX + 8, 0);
            ctx.closePath();
            ctx.fill();

            // Opening
            ctx.fillStyle = darkMode ? '#333' : '#666';
            ctx.beginPath();
            ctx.ellipse(tubeX, -tubeHeight + sway, 6, 3, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          break;

        case 'mushroom':
          // Mushroom coral
          const capGradient = ctx.createRadialGradient(
            -size * 0.1, -size * 0.35, 0,
            0, -size * 0.3, size * 0.5
          );
          capGradient.addColorStop(0, '#FFF');
          capGradient.addColorStop(0.3, coral.color);
          capGradient.addColorStop(1, darkMode ? '#333' : '#555');

          ctx.fillStyle = capGradient;
          ctx.beginPath();
          ctx.ellipse(0, -size * 0.3, size * 0.45, size * 0.25, 0, Math.PI, Math.PI * 2);
          ctx.fill();

          // Ridges
          ctx.strokeStyle = darkMode ? '#444' : '#666';
          ctx.lineWidth = 1;
          for (let i = 0; i < 10; i++) {
            const ridgeX = -size * 0.35 + (i / 9) * size * 0.7;
            ctx.beginPath();
            ctx.moveTo(ridgeX, -size * 0.3);
            ctx.lineTo(ridgeX, -size * 0.1);
            ctx.stroke();
          }
          break;
      }

      ctx.restore();
    };

    const drawFish = (ctx: CanvasRenderingContext2D, f: Fish) => {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(f.direction, 1);

      const size = f.size;
      const tailWag = Math.sin(timeRef * 0.1 + f.tailPhase) * 0.3;

      ctx.globalAlpha = f.depth;

      // Get colors based on fish type
      let bodyColor: string, stripeColor: string, finColor: string;
      switch (f.type) {
        case 'clown':
          bodyColor = '#FF6B35';
          stripeColor = '#FFFFFF';
          finColor = '#000000';
          break;
        case 'tang':
          bodyColor = '#4169E1';
          stripeColor = '#FFD700';
          finColor = '#FFD700';
          break;
        case 'angel':
          bodyColor = '#9370DB';
          stripeColor = '#FFD700';
          finColor = '#4169E1';
          break;
        case 'butterfly':
          bodyColor = '#FFD700';
          stripeColor = '#000000';
          finColor = '#FFFFFF';
          break;
        case 'nemo':
          bodyColor = '#FF4500';
          stripeColor = '#FFFFFF';
          finColor = '#000000';
          break;
      }

      // Tail
      ctx.fillStyle = finColor;
      ctx.beginPath();
      ctx.moveTo(-size * 0.4, 0);
      ctx.lineTo(-size * 0.8, -size * 0.3 + tailWag * size);
      ctx.lineTo(-size * 0.7, 0);
      ctx.lineTo(-size * 0.8, size * 0.3 + tailWag * size);
      ctx.closePath();
      ctx.fill();

      // Body
      const bodyGradient = ctx.createRadialGradient(
        size * 0.1, -size * 0.1, 0,
        0, 0, size * 0.5
      );
      bodyGradient.addColorStop(0, '#FFF');
      bodyGradient.addColorStop(0.3, bodyColor);
      bodyGradient.addColorStop(1, bodyColor);

      ctx.fillStyle = bodyGradient;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.5, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Stripes
      ctx.fillStyle = stripeColor;
      if (f.type === 'clown' || f.type === 'nemo') {
        ctx.beginPath();
        ctx.ellipse(-size * 0.15, 0, size * 0.05, size * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(size * 0.2, 0, size * 0.05, size * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.type === 'tang') {
        ctx.beginPath();
        ctx.ellipse(size * 0.1, 0, size * 0.08, size * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.type === 'butterfly') {
        ctx.beginPath();
        ctx.arc(size * 0.15, 0, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }

      // Dorsal fin
      ctx.fillStyle = finColor;
      ctx.beginPath();
      ctx.moveTo(-size * 0.1, -size * 0.3);
      ctx.quadraticCurveTo(0, -size * 0.5, size * 0.2, -size * 0.3);
      ctx.lineTo(-size * 0.1, -size * 0.3);
      ctx.fill();

      // Eye
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(size * 0.25, -size * 0.05, size * 0.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(size * 0.28, -size * 0.05, size * 0.05, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(size * 0.3, -size * 0.07, size * 0.02, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.restore();
    };

    const drawSeaPlant = (ctx: CanvasRenderingContext2D, plant: SeaPlant) => {
      ctx.save();
      ctx.translate(plant.x, plant.y);

      const segmentHeight = plant.height / plant.segments;

      for (let blade = 0; blade < 3; blade++) {
        const bladeOffset = (blade - 1) * 10;

        ctx.strokeStyle = plant.color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bladeOffset, 0);

        let x = bladeOffset;
        let y = 0;

        for (let i = 0; i < plant.segments; i++) {
          const sway = Math.sin(timeRef * 0.002 * plant.swaySpeed + plant.swayPhase + i * 0.5) * 15;
          x += sway / plant.segments;
          y -= segmentHeight;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.restore();
    };

    const drawBubble = (ctx: CanvasRenderingContext2D, bubble: Bubble) => {
      const wobble = Math.sin(timeRef * 0.05 + bubble.wobble) * 2;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bubble.x + wobble, bubble.y, bubble.size, 0, Math.PI * 2);
      ctx.stroke();

      // Highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(bubble.x + wobble - bubble.size * 0.3, bubble.y - bubble.size * 0.3, bubble.size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawStarfish = (ctx: CanvasRenderingContext2D, star: Starfish) => {
      ctx.save();
      ctx.translate(star.x, star.y);
      ctx.rotate(star.rotation);

      const size = star.size;

      // Draw 5-pointed star
      ctx.fillStyle = star.color;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const outerX = Math.cos(angle) * size;
        const outerY = Math.sin(angle) * size;
        const innerAngle = angle + Math.PI / 5;
        const innerX = Math.cos(innerAngle) * size * 0.4;
        const innerY = Math.sin(innerAngle) * size * 0.4;

        if (i === 0) {
          ctx.moveTo(outerX, outerY);
        } else {
          ctx.lineTo(outerX, outerY);
        }
        ctx.lineTo(innerX, innerY);
      }
      ctx.closePath();
      ctx.fill();

      // Texture dots
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      for (let i = 0; i < 15; i++) {
        const dotAngle = Math.random() * Math.PI * 2;
        const dotDist = Math.random() * size * 0.7;
        ctx.beginPath();
        ctx.arc(Math.cos(dotAngle) * dotDist, Math.sin(dotAngle) * dotDist, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const drawJellyfish = (ctx: CanvasRenderingContext2D, jelly: Jellyfish) => {
      ctx.save();
      ctx.translate(jelly.x, jelly.y);

      const size = jelly.size;
      const pulse = Math.sin(timeRef * 0.03 + jelly.pulsePhase) * 0.2;

      // Bell (dome)
      ctx.fillStyle = jelly.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * (0.8 + pulse), size * (0.5 - pulse * 0.5), 0, Math.PI, Math.PI * 2);
      ctx.fill();

      // Inner glow
      const glowGradient = ctx.createRadialGradient(0, -size * 0.1, 0, 0, 0, size * 0.5);
      glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      glowGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.1, size * 0.4, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tentacles
      ctx.strokeStyle = jelly.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const tentacleX = -size * 0.6 + (i / 7) * size * 1.2;
        const wave1 = Math.sin(timeRef * 0.02 + jelly.tentaclePhase + i) * 10;
        const wave2 = Math.sin(timeRef * 0.015 + jelly.tentaclePhase + i * 1.5) * 8;

        ctx.beginPath();
        ctx.moveTo(tentacleX, 0);
        ctx.bezierCurveTo(
          tentacleX + wave1, size * 0.5,
          tentacleX + wave2, size,
          tentacleX + wave1 + wave2, size * 1.5
        );
        ctx.stroke();
      }

      ctx.restore();
    };

    const updateFish = (f: Fish, width: number, height: number) => {
      const dx = f.targetX - f.x;
      const dy = f.targetY - f.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 20) {
        f.targetX = getRandomSidePosition(width);
        f.targetY = height * 0.2 + Math.random() * height * 0.5;
      } else {
        f.x += (dx / dist) * f.speed;
        f.y += (dy / dist) * f.speed;
        f.direction = dx > 0 ? 1 : -1;
      }

      f.tailPhase += 0.2;
    };

    const updateJellyfish = (jelly: Jellyfish, width: number, height: number) => {
      // Gentle floating motion
      jelly.y += Math.sin(timeRef * 0.01 + jelly.pulsePhase) * 0.3 - 0.1;
      jelly.x += jelly.direction * 0.2;

      if (jelly.y < height * 0.1) {
        jelly.y = height * 0.1;
      }
      if (jelly.y > height * 0.6) {
        jelly.y = height * 0.6;
      }
      if (jelly.x < 0 || jelly.x > width) {
        jelly.direction *= -1;
      }

      jelly.pulsePhase += 0.02;
      jelly.tentaclePhase += 0.01;
    };

    const animate = () => {
      const { width, height } = canvas;
      timeRef++;

      ctx.clearRect(0, 0, width, height);

      // Draw background
      drawBackground(ctx, width, height);

      // Draw light rays
      lightRays.forEach(ray => {
        ray.x += ray.speed;
        if (ray.x > width + ray.width) {
          ray.x = -ray.width;
        }
        drawLightRay(ctx, ray, height);
      });

      // Draw sea plants
      seaPlants.forEach(plant => drawSeaPlant(ctx, plant));

      // Draw corals
      corals.forEach(coral => drawCoral(ctx, coral));

      // Draw starfish
      starfish.forEach(star => drawStarfish(ctx, star));

      // Update and draw fish (sorted by depth)
      fish.sort((a, b) => a.depth - b.depth);
      fish.forEach(f => {
        updateFish(f, width, height);
        drawFish(ctx, f);
      });

      // Update and draw jellyfish
      jellyfish.forEach(jelly => {
        updateJellyfish(jelly, width, height);
        drawJellyfish(ctx, jelly);
      });

      // Add bubbles occasionally
      if (Math.random() < 0.02) {
        bubbles.push({
          x: getRandomSidePosition(width),
          y: height,
          size: 2 + Math.random() * 5,
          speed: 0.5 + Math.random() * 1,
          wobble: Math.random() * Math.PI * 2,
        });
      }

      // Update and draw bubbles
      bubbles = bubbles.filter(b => {
        b.y -= b.speed;
        drawBubble(ctx, b);
        return b.y > -10;
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
