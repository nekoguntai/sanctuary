/**
 * Sleeping Kittens Animation
 *
 * Adorable curled-up kittens breathing gently.
 * Soft, cozy atmosphere with gentle movements.
 * Pre-generates all random values to avoid flickering.
 */

import { useEffect, useRef } from 'react';

interface Kitten {
  x: number;
  y: number;
  size: number;
  breathPhase: number;
  breathSpeed: number;
  color: string;
  markingColor: string;
  hasStripes: boolean;
  stripeAngles: number[];
  earTwitchPhase: number;
  earTwitchInterval: number;
  tailCurlPhase: number;
  facingLeft: boolean;
}

interface Cushion {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  patternType: 'solid' | 'stripes' | 'dots';
  patternColor: string;
}

interface DustMote {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  driftX: number;
  driftY: number;
}

export function useSleepingKittens(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const kittensRef = useRef<Kitten[]>([]);
  const cushionsRef = useRef<Cushion[]>([]);
  const dustRef = useRef<DustMote[]>([]);
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

      const catColors = [
        { main: '#F5DEB3', marking: '#D2691E' }, // Ginger
        { main: '#808080', marking: '#404040' }, // Gray tabby
        { main: '#FFF8DC', marking: '#DEB887' }, // Cream
        { main: '#2F2F2F', marking: '#1a1a1a' }, // Black
        { main: '#FFFFFF', marking: '#E0E0E0' }, // White
        { main: '#8B4513', marking: '#654321' }, // Brown
      ];

      const cushionColors = [
        { main: '#E6B8AF', pattern: '#D4A69A' }, // Dusty rose
        { main: '#B4C7DC', pattern: '#9AB4CC' }, // Soft blue
        { main: '#C5D6A3', pattern: '#B3C78F' }, // Sage
        { main: '#E8D4C4', pattern: '#D8C4B4' }, // Beige
        { main: '#D4C4E8', pattern: '#C4B4D8' }, // Lavender
      ];

      // Create cushions first
      cushionsRef.current = [];
      const cushionCount = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < cushionCount; i++) {
        const cushColor = cushionColors[Math.floor(Math.random() * cushionColors.length)];
        cushionsRef.current.push({
          x: width * 0.15 + (i / cushionCount) * width * 0.6 + Math.random() * 100,
          y: height * 0.5 + Math.random() * height * 0.2,
          width: 120 + Math.random() * 60,
          height: 40 + Math.random() * 30,
          color: cushColor.main,
          patternType: ['solid', 'stripes', 'dots'][Math.floor(Math.random() * 3)] as 'solid' | 'stripes' | 'dots',
          patternColor: cushColor.pattern,
        });
      }

      // Create kittens on cushions
      kittensRef.current = [];
      cushionsRef.current.forEach((cushion) => {
        const kittenCount = 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < kittenCount; k++) {
          const colors = catColors[Math.floor(Math.random() * catColors.length)];
          const stripeCount = 3 + Math.floor(Math.random() * 4);
          const stripeAngles: number[] = [];
          for (let s = 0; s < stripeCount; s++) {
            stripeAngles.push((Math.random() - 0.5) * 0.5);
          }

          kittensRef.current.push({
            x: cushion.x + (k - 0.5) * 40 + (Math.random() - 0.5) * 20,
            y: cushion.y - cushion.height * 0.3,
            size: 25 + Math.random() * 15,
            breathPhase: Math.random() * Math.PI * 2,
            breathSpeed: 0.0015 + Math.random() * 0.001,
            color: colors.main,
            markingColor: colors.marking,
            hasStripes: Math.random() > 0.4,
            stripeAngles,
            earTwitchPhase: Math.random() * Math.PI * 2,
            earTwitchInterval: 3000 + Math.random() * 5000,
            tailCurlPhase: Math.random() * Math.PI * 2,
            facingLeft: Math.random() > 0.5,
          });
        }
      });

      // Create floating dust motes in sunbeam
      dustRef.current = [];
      for (let i = 0; i < 20; i++) {
        dustRef.current.push({
          x: width * 0.3 + Math.random() * width * 0.4,
          y: Math.random() * height * 0.7,
          size: 1 + Math.random() * 2,
          phase: Math.random() * Math.PI * 2,
          speed: 0.001 + Math.random() * 0.002,
          driftX: (Math.random() - 0.5) * 0.1,
          driftY: -0.05 - Math.random() * 0.05,
        });
      }
    };

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      if (darkMode) {
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#2d2d3a');
      } else {
        gradient.addColorStop(0, '#FFF8E7');
        gradient.addColorStop(0.5, '#FFF5E0');
        gradient.addColorStop(1, '#FFE4C4');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Warm sunbeam
      const beamGradient = ctx.createLinearGradient(
        canvas.width * 0.3,
        0,
        canvas.width * 0.7,
        canvas.height
      );
      if (darkMode) {
        beamGradient.addColorStop(0, 'rgba(80, 70, 60, 0.1)');
        beamGradient.addColorStop(1, 'rgba(80, 70, 60, 0.05)');
      } else {
        beamGradient.addColorStop(0, 'rgba(255, 230, 150, 0.2)');
        beamGradient.addColorStop(1, 'rgba(255, 230, 150, 0.05)');
      }
      ctx.fillStyle = beamGradient;
      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.3, 0);
      ctx.lineTo(canvas.width * 0.5, 0);
      ctx.lineTo(canvas.width * 0.8, canvas.height);
      ctx.lineTo(canvas.width * 0.4, canvas.height);
      ctx.closePath();
      ctx.fill();
    };

    const drawCushion = (cushion: Cushion) => {
      ctx.save();
      ctx.translate(cushion.x, cushion.y);

      // Cushion shadow
      ctx.beginPath();
      ctx.ellipse(5, 5, cushion.width * 0.5, cushion.height * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fill();

      // Main cushion
      ctx.beginPath();
      ctx.ellipse(0, 0, cushion.width * 0.5, cushion.height * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = cushion.color;
      ctx.fill();

      // Pattern
      if (cushion.patternType === 'stripes') {
        ctx.strokeStyle = cushion.patternColor;
        ctx.lineWidth = 3;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 15, -cushion.height * 0.3);
          ctx.lineTo(i * 15, cushion.height * 0.3);
          ctx.stroke();
        }
      } else if (cushion.patternType === 'dots') {
        ctx.fillStyle = cushion.patternColor;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            ctx.beginPath();
            ctx.arc(dx * 20, dy * 15, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Cushion edge highlight
      ctx.beginPath();
      ctx.ellipse(0, 0, cushion.width * 0.5, cushion.height * 0.4, 0, Math.PI, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    };

    const drawKitten = (kitten: Kitten, time: number) => {
      const breathScale = 1 + Math.sin(time * kitten.breathSpeed + kitten.breathPhase) * 0.03;
      const direction = kitten.facingLeft ? -1 : 1;

      ctx.save();
      ctx.translate(kitten.x, kitten.y);
      ctx.scale(direction, 1);

      const size = kitten.size;

      // Body (curled up oval)
      ctx.beginPath();
      ctx.ellipse(0, 0, size * breathScale, size * 0.6 * breathScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = kitten.color;
      ctx.fill();

      // Stripes on body
      if (kitten.hasStripes) {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = kitten.markingColor;
        ctx.lineWidth = 3;
        kitten.stripeAngles.forEach((angle, i) => {
          const x = -size * 0.6 + (i / kitten.stripeAngles.length) * size * 1.2;
          ctx.beginPath();
          ctx.moveTo(x, -size * 0.5);
          ctx.lineTo(x + Math.sin(angle) * 10, size * 0.5);
          ctx.stroke();
        });
        ctx.restore();
      }

      // Head
      const headX = size * 0.5;
      const headY = -size * 0.1;
      ctx.beginPath();
      ctx.arc(headX, headY, size * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = kitten.color;
      ctx.fill();

      // Ears
      const earTwitch = Math.sin(time / kitten.earTwitchInterval) > 0.95 ? Math.sin(time * 0.05) * 0.1 : 0;

      // Left ear
      ctx.beginPath();
      ctx.moveTo(headX - size * 0.25, headY - size * 0.2);
      ctx.lineTo(headX - size * 0.35, headY - size * 0.55 + earTwitch * size);
      ctx.lineTo(headX - size * 0.1, headY - size * 0.3);
      ctx.closePath();
      ctx.fillStyle = kitten.color;
      ctx.fill();

      // Right ear
      ctx.beginPath();
      ctx.moveTo(headX + size * 0.25, headY - size * 0.2);
      ctx.lineTo(headX + size * 0.35, headY - size * 0.55);
      ctx.lineTo(headX + size * 0.1, headY - size * 0.3);
      ctx.closePath();
      ctx.fill();

      // Inner ears
      ctx.fillStyle = '#FFB6C1';
      ctx.beginPath();
      ctx.moveTo(headX - size * 0.22, headY - size * 0.25);
      ctx.lineTo(headX - size * 0.3, headY - size * 0.45 + earTwitch * size);
      ctx.lineTo(headX - size * 0.14, headY - size * 0.3);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(headX + size * 0.22, headY - size * 0.25);
      ctx.lineTo(headX + size * 0.3, headY - size * 0.45);
      ctx.lineTo(headX + size * 0.14, headY - size * 0.3);
      ctx.closePath();
      ctx.fill();

      // Closed eyes (curved lines)
      ctx.strokeStyle = darkMode ? '#4a4a4a' : '#333';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';

      // Left eye
      ctx.beginPath();
      ctx.arc(headX - size * 0.12, headY - size * 0.05, size * 0.08, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // Right eye
      ctx.beginPath();
      ctx.arc(headX + size * 0.12, headY - size * 0.05, size * 0.08, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // Nose
      ctx.fillStyle = '#FFB6C1';
      ctx.beginPath();
      ctx.moveTo(headX, headY + size * 0.05);
      ctx.lineTo(headX - size * 0.05, headY + size * 0.12);
      ctx.lineTo(headX + size * 0.05, headY + size * 0.12);
      ctx.closePath();
      ctx.fill();

      // Whiskers
      ctx.strokeStyle = darkMode ? '#6a6a6a' : '#888';
      ctx.lineWidth = 1;

      for (let w = 0; w < 3; w++) {
        const wy = headY + size * 0.08 + w * size * 0.04;
        // Left whiskers
        ctx.beginPath();
        ctx.moveTo(headX - size * 0.15, wy);
        ctx.lineTo(headX - size * 0.4, wy - size * 0.05 + w * size * 0.03);
        ctx.stroke();
        // Right whiskers
        ctx.beginPath();
        ctx.moveTo(headX + size * 0.15, wy);
        ctx.lineTo(headX + size * 0.4, wy - size * 0.05 + w * size * 0.03);
        ctx.stroke();
      }

      // Tail (curled around body)
      const tailWave = Math.sin(time * 0.001 + kitten.tailCurlPhase) * 0.1;
      ctx.beginPath();
      ctx.moveTo(-size * 0.7, size * 0.1);
      ctx.quadraticCurveTo(
        -size * 1.2,
        size * 0.3 + tailWave * size,
        -size * 0.8,
        size * 0.5 + tailWave * size
      );
      ctx.quadraticCurveTo(
        -size * 0.4,
        size * 0.6,
        0,
        size * 0.4
      );
      ctx.strokeStyle = kitten.color;
      ctx.lineWidth = size * 0.15;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Paw peeking out
      ctx.beginPath();
      ctx.ellipse(size * 0.3, size * 0.3, size * 0.15, size * 0.1, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = kitten.color;
      ctx.fill();

      // Paw pads
      ctx.fillStyle = '#FFB6C1';
      ctx.beginPath();
      ctx.arc(size * 0.32, size * 0.32, size * 0.04, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const drawDustMotes = (time: number) => {
      dustRef.current.forEach((mote) => {
        const opacity = (Math.sin(time * mote.speed + mote.phase) + 1) * 0.3;

        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
        ctx.fillStyle = darkMode
          ? `rgba(150, 140, 130, ${opacity})`
          : `rgba(255, 230, 180, ${opacity})`;
        ctx.fill();

        // Drift
        mote.x += mote.driftX + Math.sin(time * 0.001 + mote.phase) * 0.1;
        mote.y += mote.driftY;

        // Reset if off screen
        if (mote.y < 0 || mote.x < 0 || mote.x > canvas.width) {
          mote.y = canvas.height * 0.8;
          mote.x = canvas.width * 0.3 + Math.random() * canvas.width * 0.4;
        }
      });
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawBackground();
      drawDustMotes(time);

      // Draw cushions
      cushionsRef.current.forEach((cushion) => drawCushion(cushion));

      // Draw kittens
      kittensRef.current.forEach((kitten) => drawKitten(kitten, time));

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
