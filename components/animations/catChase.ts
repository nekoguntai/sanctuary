/**
 * Cat Chase Animation
 * A realistic cat with proper segmented tail physics and accurate body proportions
 * Features: smooth tail movement with follow-through, proper cat anatomy, fluid animations
 */

import { useRef, useEffect, useCallback } from 'react';

interface TailSegment {
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
}

interface Cat {
  x: number;
  y: number;
  size: number;
  direction: number; // 1 = right, -1 = left
  speed: number;
  walkPhase: number;
  tailSegments: TailSegment[];
  tailBaseAngle: number;
  colorScheme: number;
  state: 'chasing' | 'thinking' | 'tired' | 'pouncing' | 'stalking' | 'sitting';
  stateTimer: number;
  energy: number;
  earTwitch: number;
  earTwitchTarget: number;
  whiskerTwitch: number;
  blinkTimer: number;
  blinkState: number;
  pupilDilateTarget: number;
  pupilDilateCurrent: number;
  breathePhase: number;
  headTilt: number;
  targetHeadTilt: number;
}

interface ChaseObject {
  x: number;
  y: number;
  type: 'yarn' | 'butterfly' | 'mouse' | 'laser';
  size: number;
  speed: number;
  direction: number;
  phase: number;
  colorScheme: number;
  changeTimer: number;
  wobbleY: number;
}

const TAIL_SEGMENTS = 8;
const TAIL_SEGMENT_LENGTH = 0.08; // Relative to cat size

export function useCatChase(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const catRef = useRef<Cat | null>(null);
  const objectRef = useRef<ChaseObject | null>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  // Detailed cat color schemes
  const catColors = darkMode
    ? [
        // Gray tabby
        {
          furBase: [95, 95, 100], furLight: [130, 130, 135], furDark: [60, 60, 65],
          stripes: [50, 50, 55], belly: [150, 150, 155], nose: [200, 150, 155],
          pawPads: [180, 140, 145], innerEar: [200, 160, 165], eyeColor: [120, 200, 100],
          eyeRim: [40, 40, 45]
        },
        // Orange tabby
        {
          furBase: [255, 180, 130], furLight: [255, 210, 170], furDark: [200, 130, 80],
          stripes: [180, 100, 50], belly: [255, 235, 210], nose: [220, 160, 160],
          pawPads: [200, 150, 150], innerEar: [255, 200, 190], eyeColor: [180, 200, 80],
          eyeRim: [120, 70, 30]
        },
        // Black cat
        {
          furBase: [45, 45, 50], furLight: [75, 75, 80], furDark: [25, 25, 30],
          stripes: [35, 35, 40], belly: [65, 65, 70], nose: [80, 60, 65],
          pawPads: [60, 50, 55], innerEar: [100, 80, 85], eyeColor: [220, 180, 60],
          eyeRim: [20, 20, 25]
        },
        // White cat
        {
          furBase: [250, 250, 252], furLight: [255, 255, 255], furDark: [220, 220, 225],
          stripes: [240, 240, 242], belly: [255, 255, 255], nose: [220, 180, 185],
          pawPads: [230, 190, 195], innerEar: [250, 210, 215], eyeColor: [100, 180, 220],
          eyeRim: [180, 180, 185]
        },
        // Tuxedo
        {
          furBase: [40, 40, 45], furLight: [70, 70, 75], furDark: [25, 25, 30],
          stripes: [30, 30, 35], belly: [250, 250, 252], nose: [80, 60, 65],
          pawPads: [60, 50, 55], innerEar: [100, 80, 85], eyeColor: [150, 200, 120],
          eyeRim: [20, 20, 25]
        },
      ]
    : [
        {
          furBase: [80, 80, 85], furLight: [115, 115, 120], furDark: [50, 50, 55],
          stripes: [40, 40, 45], belly: [135, 135, 140], nose: [180, 130, 135],
          pawPads: [160, 120, 125], innerEar: [180, 140, 145], eyeColor: [100, 180, 80],
          eyeRim: [30, 30, 35]
        },
        {
          furBase: [235, 160, 110], furLight: [245, 190, 150], furDark: [180, 110, 60],
          stripes: [160, 80, 30], belly: [245, 215, 190], nose: [200, 140, 140],
          pawPads: [180, 130, 130], innerEar: [235, 180, 170], eyeColor: [160, 180, 60],
          eyeRim: [100, 50, 20]
        },
        {
          furBase: [35, 35, 40], furLight: [65, 65, 70], furDark: [20, 20, 25],
          stripes: [30, 30, 35], belly: [55, 55, 60], nose: [70, 50, 55],
          pawPads: [50, 40, 45], innerEar: [90, 70, 75], eyeColor: [200, 160, 40],
          eyeRim: [15, 15, 20]
        },
        {
          furBase: [240, 240, 242], furLight: [250, 250, 252], furDark: [210, 210, 215],
          stripes: [230, 230, 232], belly: [250, 250, 252], nose: [210, 170, 175],
          pawPads: [220, 180, 185], innerEar: [240, 200, 205], eyeColor: [80, 160, 200],
          eyeRim: [170, 170, 175]
        },
        {
          furBase: [30, 30, 35], furLight: [60, 60, 65], furDark: [20, 20, 25],
          stripes: [25, 25, 30], belly: [240, 240, 242], nose: [70, 50, 55],
          pawPads: [50, 40, 45], innerEar: [90, 70, 75], eyeColor: [130, 180, 100],
          eyeRim: [15, 15, 20]
        },
      ];

  const objectColors = {
    yarn: darkMode ? [[255, 100, 100], [100, 180, 255], [255, 180, 80], [180, 130, 255]] : [[235, 80, 80], [80, 160, 235], [235, 160, 60], [160, 110, 235]],
    butterfly: darkMode ? [[255, 180, 200], [180, 200, 255], [255, 220, 150]] : [[235, 160, 180], [160, 180, 235], [235, 200, 130]],
    mouse: darkMode ? [[140, 130, 125], [160, 150, 145]] : [[120, 110, 105], [140, 130, 125]],
    laser: darkMode ? [[255, 50, 50]] : [[255, 30, 30]],
  };

  const createTailSegments = (): TailSegment[] => {
    const segments: TailSegment[] = [];
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      segments.push({
        x: 0,
        y: 0,
        angle: -Math.PI * 0.3, // Start pointing up and back
        targetAngle: -Math.PI * 0.3,
      });
    }
    return segments;
  };

  const createObject = useCallback((canvas: HTMLCanvasElement): ChaseObject => {
    const types: ChaseObject['type'][] = ['yarn', 'butterfly', 'mouse', 'laser'];
    const type = types[Math.floor(Math.random() * types.length)];
    const colorOptions = objectColors[type];
    const direction = Math.random() < 0.5 ? 1 : -1;

    return {
      x: direction > 0 ? -50 : canvas.width + 50,
      y: canvas.height * 0.65 + Math.random() * canvas.height * 0.15,
      type,
      size: type === 'laser' ? 12 : type === 'butterfly' ? 20 : 22,
      speed: type === 'laser' ? 2.5 : type === 'mouse' ? 1.8 : 1.0,
      direction,
      phase: Math.random() * Math.PI * 2,
      colorScheme: Math.floor(Math.random() * colorOptions.length),
      changeTimer: 200 + Math.random() * 200,
      wobbleY: 0,
    };
  }, [darkMode]);

  const createCat = useCallback((canvas: HTMLCanvasElement): Cat => ({
    x: canvas.width / 2,
    y: canvas.height * 0.72,
    size: 70,
    direction: 1,
    speed: 0,
    walkPhase: 0,
    tailSegments: createTailSegments(),
    tailBaseAngle: -Math.PI * 0.35,
    colorScheme: Math.floor(Math.random() * 5),
    state: 'sitting',
    stateTimer: 60,
    energy: 100,
    earTwitch: 0,
    earTwitchTarget: 0,
    whiskerTwitch: 0,
    blinkTimer: 100 + Math.random() * 200,
    blinkState: 1,
    pupilDilateTarget: 0.8,
    pupilDilateCurrent: 0.8,
    breathePhase: Math.random() * Math.PI * 2,
    headTilt: 0,
    targetHeadTilt: 0,
  }), []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      if (!catRef.current) {
        catRef.current = createCat(canvas);
      }
      if (!objectRef.current) {
        objectRef.current = createObject(canvas);
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Update tail segments with physics-like follow behavior
    const updateTailSegments = (cat: Cat) => {
      const s = cat.size;
      const segmentLength = s * TAIL_SEGMENT_LENGTH;
      const time = timeRef.current;

      // Base position at cat's rear
      const baseX = -s * 0.4;
      const baseY = -s * 0.05;

      // Tail base angle based on state and mood
      let targetBaseAngle = -Math.PI * 0.35; // Default upward curve
      let waveMagnitude = 0.08; // Subtle wave
      let waveSpeed = 1.2;

      if (cat.state === 'chasing' || cat.state === 'pouncing') {
        targetBaseAngle = -Math.PI * 0.15; // More horizontal when running
        waveMagnitude = 0.15;
        waveSpeed = 2.0;
      } else if (cat.state === 'stalking') {
        targetBaseAngle = -Math.PI * 0.1; // Low and straight when stalking
        waveMagnitude = 0.05; // Very subtle tip twitch
        waveSpeed = 3.0; // Faster small twitches
      } else if (cat.state === 'thinking' || cat.state === 'sitting') {
        targetBaseAngle = -Math.PI * 0.5; // Curved up when relaxed
        waveMagnitude = 0.12;
        waveSpeed = 0.8;
      } else if (cat.state === 'tired') {
        targetBaseAngle = Math.PI * 0.1; // Droopy when tired
        waveMagnitude = 0.03;
        waveSpeed = 0.5;
      }

      // Smoothly interpolate base angle
      cat.tailBaseAngle += (targetBaseAngle - cat.tailBaseAngle) * 0.03;

      // Update each segment with follow-through physics
      for (let i = 0; i < cat.tailSegments.length; i++) {
        const segment = cat.tailSegments[i];
        const progress = i / (cat.tailSegments.length - 1);

        // Each segment follows the previous with delay
        if (i === 0) {
          // First segment attached to body
          segment.x = baseX;
          segment.y = baseY;
          segment.targetAngle = cat.tailBaseAngle;
        } else {
          const prev = cat.tailSegments[i - 1];

          // Follow the previous segment
          const dx = segment.x - prev.x;
          const dy = segment.y - prev.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > 0.01) {
            // Calculate angle from previous segment
            segment.targetAngle = Math.atan2(dy, dx);
          }

          // Add gentle wave motion that increases toward the tip
          const waveOffset = Math.sin(time * waveSpeed - i * 0.4) * waveMagnitude * progress;
          segment.targetAngle += waveOffset;

          // Position relative to previous segment
          segment.x = prev.x + Math.cos(prev.angle) * segmentLength;
          segment.y = prev.y + Math.sin(prev.angle) * segmentLength;
        }

        // Smooth angle interpolation (slower for more fluid movement)
        const angleDiff = segment.targetAngle - segment.angle;
        // Normalize angle difference
        const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        const followSpeed = 0.08 - progress * 0.03; // Tip follows slower for fluid motion
        segment.angle += normalizedDiff * followSpeed;
      }
    };

    // Draw chase object
    const drawObject = (obj: ChaseObject, opacityMult: number) => {
      const colors = objectColors[obj.type][obj.colorScheme] || objectColors[obj.type][0];
      const time = timeRef.current;

      ctx.save();
      ctx.translate(obj.x, obj.y + obj.wobbleY);

      if (obj.type === 'yarn') {
        // Bouncing yarn ball
        const bounce = Math.abs(Math.sin(time * 3 + obj.phase)) * 8;
        const roll = time * 2 * obj.direction;

        ctx.translate(0, -bounce);
        ctx.rotate(roll);

        // Ball with gradient
        const gradient = ctx.createRadialGradient(-obj.size * 0.2, -obj.size * 0.2, 0, 0, 0, obj.size);
        gradient.addColorStop(0, `rgba(${colors[0] + 50}, ${colors[1] + 50}, ${colors[2] + 50}, ${0.25 * opacityMult})`);
        gradient.addColorStop(0.6, `rgba(${colors[0]}, ${colors[1]}, ${colors[2]}, ${0.22 * opacityMult})`);
        gradient.addColorStop(1, `rgba(${colors[0] - 40}, ${colors[1] - 40}, ${colors[2] - 40}, ${0.18 * opacityMult})`);

        ctx.beginPath();
        ctx.arc(0, 0, obj.size, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Yarn texture lines
        ctx.strokeStyle = `rgba(${colors[0] - 30}, ${colors[1] - 30}, ${colors[2] - 30}, ${0.15 * opacityMult})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          const angle = (i / 5) * Math.PI * 2;
          ctx.arc(0, 0, obj.size * (0.5 + i * 0.08), angle, angle + Math.PI * 0.7);
          ctx.stroke();
        }

        // Trailing string
        ctx.setTransform(1, 0, 0, 1, obj.x, obj.y + obj.wobbleY - bounce);
        ctx.beginPath();
        ctx.moveTo(-obj.size * obj.direction, obj.size * 0.5);
        const stringWave = Math.sin(time * 2) * 10;
        ctx.bezierCurveTo(
          -obj.size * 2 * obj.direction, obj.size + stringWave,
          -obj.size * 3.5 * obj.direction, obj.size * 0.5 - stringWave,
          -obj.size * 5 * obj.direction, obj.size
        );
        ctx.strokeStyle = `rgba(${colors[0]}, ${colors[1]}, ${colors[2]}, ${0.18 * opacityMult})`;
        ctx.lineWidth = 3;
        ctx.stroke();

      } else if (obj.type === 'butterfly') {
        // Flying butterfly (side view)
        const wingFlap = Math.sin(time * 10 + obj.phase);
        const floatY = Math.sin(time * 1.5 + obj.phase) * 15;
        ctx.translate(0, floatY - 30);

        ctx.scale(obj.direction, 1);

        // Wings
        const wingAngle = wingFlap * 0.6;

        // Back wing
        ctx.save();
        ctx.rotate(wingAngle * 0.8);
        ctx.beginPath();
        ctx.ellipse(-obj.size * 0.1, -obj.size * 0.3, obj.size * 0.5, obj.size * 0.7, -0.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors[0] - 30}, ${colors[1] - 30}, ${colors[2] - 30}, ${0.15 * opacityMult})`;
        ctx.fill();
        ctx.restore();

        // Front wing
        ctx.save();
        ctx.rotate(wingAngle);
        ctx.beginPath();
        ctx.ellipse(obj.size * 0.1, -obj.size * 0.2, obj.size * 0.6, obj.size * 0.85, 0.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors[0]}, ${colors[1]}, ${colors[2]}, ${0.2 * opacityMult})`;
        ctx.fill();
        // Wing pattern
        ctx.beginPath();
        ctx.arc(obj.size * 0.15, -obj.size * 0.3, obj.size * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors[0] - 50}, ${colors[1] - 50}, ${colors[2] - 50}, ${0.12 * opacityMult})`;
        ctx.fill();
        ctx.restore();

        // Body
        ctx.beginPath();
        ctx.ellipse(0, 0, obj.size * 0.08, obj.size * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(50, 40, 35, ${0.2 * opacityMult})`;
        ctx.fill();

        // Antennae
        ctx.strokeStyle = `rgba(50, 40, 35, ${0.18 * opacityMult})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -obj.size * 0.3);
        ctx.quadraticCurveTo(obj.size * 0.15, -obj.size * 0.5, obj.size * 0.2, -obj.size * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -obj.size * 0.3);
        ctx.quadraticCurveTo(-obj.size * 0.1, -obj.size * 0.5, -obj.size * 0.05, -obj.size * 0.55);
        ctx.stroke();

      } else if (obj.type === 'mouse') {
        // Running mouse (side view)
        const runBob = Math.abs(Math.sin(time * 12 + obj.phase)) * 3;
        ctx.translate(0, -runBob);
        ctx.scale(obj.direction, 1);

        // Body
        const bodyGrad = ctx.createRadialGradient(-obj.size * 0.1, 0, 0, 0, 0, obj.size * 0.5);
        bodyGrad.addColorStop(0, `rgba(${colors[0] + 25}, ${colors[1] + 25}, ${colors[2] + 25}, ${0.22 * opacityMult})`);
        bodyGrad.addColorStop(1, `rgba(${colors[0]}, ${colors[1]}, ${colors[2]}, ${0.2 * opacityMult})`);

        ctx.beginPath();
        ctx.ellipse(0, 0, obj.size * 0.55, obj.size * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = bodyGrad;
        ctx.fill();

        // Head
        ctx.beginPath();
        ctx.ellipse(obj.size * 0.45, -obj.size * 0.05, obj.size * 0.32, obj.size * 0.28, 0.1, 0, Math.PI * 2);
        ctx.fill();

        // Snout
        ctx.beginPath();
        ctx.ellipse(obj.size * 0.7, 0, obj.size * 0.12, obj.size * 0.1, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors[0] + 15}, ${colors[1] + 15}, ${colors[2] + 15}, ${0.2 * opacityMult})`;
        ctx.fill();

        // Nose
        ctx.beginPath();
        ctx.arc(obj.size * 0.78, 0, obj.size * 0.04, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(40, 30, 30, ${0.22 * opacityMult})`;
        ctx.fill();

        // Eye
        ctx.beginPath();
        ctx.arc(obj.size * 0.55, -obj.size * 0.1, obj.size * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(20, 20, 20, ${0.25 * opacityMult})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(obj.size * 0.54, -obj.size * 0.11, obj.size * 0.02, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.2 * opacityMult})`;
        ctx.fill();

        // Ear
        ctx.beginPath();
        ctx.ellipse(obj.size * 0.4, -obj.size * 0.28, obj.size * 0.15, obj.size * 0.18, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors[0] + 40}, ${colors[1] + 35}, ${colors[2] + 35}, ${0.22 * opacityMult})`;
        ctx.fill();

        // Legs (running animation)
        const legPhase = time * 16;
        const frontLeg = Math.sin(legPhase) * 0.4;
        const backLeg = Math.sin(legPhase + Math.PI) * 0.4;

        ctx.fillStyle = `rgba(${colors[0]}, ${colors[1]}, ${colors[2]}, ${0.2 * opacityMult})`;
        // Front legs
        ctx.save();
        ctx.translate(obj.size * 0.25, obj.size * 0.25);
        ctx.rotate(frontLeg);
        ctx.fillRect(-obj.size * 0.03, 0, obj.size * 0.06, obj.size * 0.2);
        ctx.restore();
        // Back legs
        ctx.save();
        ctx.translate(-obj.size * 0.25, obj.size * 0.25);
        ctx.rotate(backLeg);
        ctx.fillRect(-obj.size * 0.03, 0, obj.size * 0.06, obj.size * 0.2);
        ctx.restore();

        // Tail
        ctx.strokeStyle = `rgba(${colors[0] + 30}, ${colors[1] + 25}, ${colors[2] + 25}, ${0.18 * opacityMult})`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const tailWave = Math.sin(time * 6) * 0.3;
        ctx.beginPath();
        ctx.moveTo(-obj.size * 0.5, obj.size * 0.1);
        ctx.bezierCurveTo(
          -obj.size * 0.9, obj.size * 0.1 + tailWave * 20,
          -obj.size * 1.2, -obj.size * 0.1 - tailWave * 15,
          -obj.size * 1.5, tailWave * 25
        );
        ctx.stroke();

      } else if (obj.type === 'laser') {
        // Laser dot on ground
        const pulse = 0.7 + Math.sin(time * 12) * 0.3;
        const jitter = Math.sin(time * 20) * 2;

        ctx.translate(jitter, 0);

        // Glow layers
        for (let i = 4; i >= 0; i--) {
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, obj.size * (0.8 + i * 0.6));
          grad.addColorStop(0, `rgba(255, ${180 - i * 35}, ${180 - i * 35}, ${(0.25 - i * 0.045) * opacityMult * pulse})`);
          grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
          ctx.beginPath();
          ctx.arc(0, 0, obj.size * (0.8 + i * 0.6), 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Bright core
        ctx.beginPath();
        ctx.arc(0, 0, obj.size * 0.35 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * opacityMult})`;
        ctx.fill();
      }

      ctx.restore();
    };

    // Draw realistic segmented tail
    const drawTail = (cat: Cat, baseOpacity: number, colors: typeof catColors[0]) => {
      const s = cat.size;
      const segmentLength = s * TAIL_SEGMENT_LENGTH;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw tail as connected segments with decreasing thickness
      for (let i = 0; i < cat.tailSegments.length - 1; i++) {
        const segment = cat.tailSegments[i];
        const nextSegment = cat.tailSegments[i + 1];
        const progress = i / (cat.tailSegments.length - 1);

        // Tail gets thinner toward the tip
        const thickness = s * 0.07 * (1 - progress * 0.7);

        // Color gradient from base to tip
        const colorMix = progress * 0.3;
        const r = Math.round(colors.furBase[0] * (1 - colorMix) + colors.furDark[0] * colorMix);
        const g = Math.round(colors.furBase[1] * (1 - colorMix) + colors.furDark[1] * colorMix);
        const b = Math.round(colors.furBase[2] * (1 - colorMix) + colors.furDark[2] * colorMix);

        ctx.beginPath();
        ctx.moveTo(segment.x, segment.y);
        ctx.lineTo(nextSegment.x, nextSegment.y);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${baseOpacity})`;
        ctx.lineWidth = thickness;
        ctx.stroke();
      }

      // Fluffy tip
      const lastSegment = cat.tailSegments[cat.tailSegments.length - 1];
      const tipSize = s * 0.04;
      ctx.beginPath();
      ctx.arc(lastSegment.x, lastSegment.y, tipSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.furLight[0]}, ${colors.furLight[1]}, ${colors.furLight[2]}, ${baseOpacity * 0.9})`;
      ctx.fill();

      ctx.restore();
    };

    // Draw detailed side-view cat
    const drawCat = (cat: Cat, opacityMult: number) => {
      const colors = catColors[cat.colorScheme];
      const baseOpacity = 0.28 * opacityMult;
      const time = timeRef.current;
      const s = cat.size;

      ctx.save();
      ctx.translate(cat.x, cat.y);
      ctx.scale(cat.direction, 1);

      // Walking animation values
      const isMoving = cat.state === 'chasing' || cat.state === 'stalking' || cat.state === 'pouncing';
      const walkCycle = isMoving ? cat.walkPhase : 0;
      const bodyBob = isMoving ? Math.abs(Math.sin(walkCycle * 2)) * 2 : 0;
      const breathe = Math.sin(time * (cat.state === 'tired' ? 0.8 : 1.5) + cat.breathePhase) * 1.5;

      ctx.translate(0, -bodyBob);

      // === SHADOW ===
      ctx.save();
      ctx.translate(0, s * 0.55 + bodyBob);
      const shadowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.6);
      shadowGrad.addColorStop(0, `rgba(0, 0, 0, ${0.1 * opacityMult})`);
      shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.55, s * 0.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = shadowGrad;
      ctx.fill();
      ctx.restore();

      // === TAIL (using segments) ===
      drawTail(cat, baseOpacity, colors);

      // === BACK LEGS ===
      const backLegAngle = isMoving ? Math.sin(walkCycle) * 0.4 : (cat.state === 'sitting' ? 0.7 : 0);
      const backLegLength = cat.state === 'sitting' ? s * 0.25 : s * 0.35;

      ctx.save();
      ctx.translate(-s * 0.25, s * 0.15);
      ctx.rotate(backLegAngle);

      // Upper back leg
      const backLegGrad = ctx.createLinearGradient(0, 0, 0, backLegLength);
      backLegGrad.addColorStop(0, `rgba(${colors.furBase[0]}, ${colors.furBase[1]}, ${colors.furBase[2]}, ${baseOpacity})`);
      backLegGrad.addColorStop(1, `rgba(${colors.furDark[0]}, ${colors.furDark[1]}, ${colors.furDark[2]}, ${baseOpacity})`);

      ctx.beginPath();
      ctx.ellipse(0, backLegLength * 0.5, s * 0.1, backLegLength * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = backLegGrad;
      ctx.fill();

      // Back paw
      ctx.beginPath();
      ctx.ellipse(0, backLegLength, s * 0.09, s * 0.05, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.furDark[0]}, ${colors.furDark[1]}, ${colors.furDark[2]}, ${baseOpacity})`;
      ctx.fill();

      // Toe beans
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * s * 0.025, backLegLength + s * 0.02, s * 0.015, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors.pawPads[0]}, ${colors.pawPads[1]}, ${colors.pawPads[2]}, ${baseOpacity * 0.8})`;
        ctx.fill();
      }
      ctx.restore();

      // === BODY (more elongated, cat-like) ===
      const bodyGrad = ctx.createRadialGradient(-s * 0.1, -s * 0.08, 0, 0, 0, s * 0.5);
      bodyGrad.addColorStop(0, `rgba(${colors.furLight[0]}, ${colors.furLight[1]}, ${colors.furLight[2]}, ${baseOpacity})`);
      bodyGrad.addColorStop(0.5, `rgba(${colors.furBase[0]}, ${colors.furBase[1]}, ${colors.furBase[2]}, ${baseOpacity})`);
      bodyGrad.addColorStop(1, `rgba(${colors.furDark[0]}, ${colors.furDark[1]}, ${colors.furDark[2]}, ${baseOpacity})`);

      // Main body - elongated ellipse
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.5, s * (0.28 + breathe * 0.008), 0, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // Belly (lighter underside)
      ctx.beginPath();
      ctx.ellipse(0, s * 0.1, s * 0.38, s * 0.12, 0, 0, Math.PI);
      ctx.fillStyle = `rgba(${colors.belly[0]}, ${colors.belly[1]}, ${colors.belly[2]}, ${baseOpacity * 0.7})`;
      ctx.fill();

      // Tabby stripes on body
      if (cat.colorScheme === 0 || cat.colorScheme === 1) {
        ctx.strokeStyle = `rgba(${colors.stripes[0]}, ${colors.stripes[1]}, ${colors.stripes[2]}, ${baseOpacity * 0.4})`;
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          const sx = -s * 0.2 + i * s * 0.15;
          ctx.moveTo(sx, -s * 0.22);
          ctx.quadraticCurveTo(sx - s * 0.03, 0, sx - s * 0.05, s * 0.18);
          ctx.stroke();
        }
      }

      // === FRONT LEGS ===
      const frontLegAngle = isMoving ? Math.sin(walkCycle + Math.PI) * 0.4 : (cat.state === 'sitting' ? -0.15 : 0);
      const frontLegLength = s * 0.38;

      ctx.save();
      ctx.translate(s * 0.28, s * 0.12);
      ctx.rotate(frontLegAngle);

      // Front leg
      const frontLegGrad = ctx.createLinearGradient(0, 0, 0, frontLegLength);
      frontLegGrad.addColorStop(0, `rgba(${colors.furBase[0]}, ${colors.furBase[1]}, ${colors.furBase[2]}, ${baseOpacity})`);
      frontLegGrad.addColorStop(1, `rgba(${colors.furDark[0]}, ${colors.furDark[1]}, ${colors.furDark[2]}, ${baseOpacity})`);

      ctx.beginPath();
      ctx.ellipse(0, frontLegLength * 0.5, s * 0.08, frontLegLength * 0.52, 0, 0, Math.PI * 2);
      ctx.fillStyle = frontLegGrad;
      ctx.fill();

      // Front paw
      ctx.beginPath();
      ctx.ellipse(0, frontLegLength, s * 0.08, s * 0.045, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.furDark[0]}, ${colors.furDark[1]}, ${colors.furDark[2]}, ${baseOpacity})`;
      ctx.fill();

      // Toe beans
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * s * 0.02, frontLegLength + s * 0.015, s * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors.pawPads[0]}, ${colors.pawPads[1]}, ${colors.pawPads[2]}, ${baseOpacity * 0.8})`;
        ctx.fill();
      }
      ctx.restore();

      // === HEAD (more triangular, proper cat proportions) ===
      cat.headTilt += (cat.targetHeadTilt - cat.headTilt) * 0.04;
      const headY = cat.state === 'stalking' ? s * 0.02 : -s * 0.12;

      ctx.save();
      ctx.translate(s * 0.4, headY);
      ctx.rotate(cat.headTilt);

      // Head shape - more triangular/wedge-shaped
      const headGrad = ctx.createRadialGradient(-s * 0.03, -s * 0.03, 0, 0, 0, s * 0.28);
      headGrad.addColorStop(0, `rgba(${colors.furLight[0]}, ${colors.furLight[1]}, ${colors.furLight[2]}, ${baseOpacity})`);
      headGrad.addColorStop(0.6, `rgba(${colors.furBase[0]}, ${colors.furBase[1]}, ${colors.furBase[2]}, ${baseOpacity})`);
      headGrad.addColorStop(1, `rgba(${colors.furDark[0]}, ${colors.furDark[1]}, ${colors.furDark[2]}, ${baseOpacity})`);

      // Main head (slightly flattened on top for cat shape)
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.23, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = headGrad;
      ctx.fill();

      // Cheek fluff (cats have prominent cheeks)
      ctx.beginPath();
      ctx.ellipse(-s * 0.06, s * 0.06, s * 0.16, s * 0.1, 0.15, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.furLight[0]}, ${colors.furLight[1]}, ${colors.furLight[2]}, ${baseOpacity * 0.5})`;
      ctx.fill();

      // Muzzle bump
      ctx.beginPath();
      ctx.ellipse(s * 0.15, s * 0.04, s * 0.1, s * 0.08, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.furLight[0]}, ${colors.furLight[1]}, ${colors.furLight[2]}, ${baseOpacity * 0.4})`;
      ctx.fill();

      // === EAR ===
      cat.earTwitch += (cat.earTwitchTarget - cat.earTwitch) * 0.1;
      const earTwitchOffset = cat.earTwitch * 0.15;

      ctx.save();
      ctx.translate(s * 0.03, -s * 0.18);
      ctx.rotate(-0.25 + earTwitchOffset);

      // Outer ear (triangular)
      ctx.beginPath();
      ctx.moveTo(0, s * 0.08);
      ctx.lineTo(-s * 0.06, -s * 0.12);
      ctx.lineTo(s * 0.08, -s * 0.1);
      ctx.lineTo(s * 0.1, s * 0.04);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.furBase[0]}, ${colors.furBase[1]}, ${colors.furBase[2]}, ${baseOpacity})`;
      ctx.fill();

      // Inner ear
      ctx.beginPath();
      ctx.moveTo(s * 0.01, s * 0.04);
      ctx.lineTo(-s * 0.03, -s * 0.08);
      ctx.lineTo(s * 0.06, -s * 0.06);
      ctx.lineTo(s * 0.07, s * 0.02);
      ctx.closePath();
      ctx.fillStyle = `rgba(${colors.innerEar[0]}, ${colors.innerEar[1]}, ${colors.innerEar[2]}, ${baseOpacity * 0.7})`;
      ctx.fill();

      // Ear fur tufts
      ctx.strokeStyle = `rgba(${colors.furLight[0]}, ${colors.furLight[1]}, ${colors.furLight[2]}, ${baseOpacity * 0.4})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * 0.02, s * 0.05);
        ctx.lineTo(s * (0.01 + i * 0.012), s * (-0.01 - i * 0.015));
        ctx.stroke();
      }
      ctx.restore();

      // === LARGE ANIME EYE ===
      const eyeOpen = cat.blinkState;
      cat.pupilDilateCurrent += (cat.pupilDilateTarget - cat.pupilDilateCurrent) * 0.06;
      const pupilSize = cat.pupilDilateCurrent;

      ctx.save();
      ctx.translate(s * 0.1, -s * 0.02);

      // Eye white
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.1, s * 0.09 * eyeOpen, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${baseOpacity * 1.1})`;
      ctx.fill();

      if (eyeOpen > 0.15) {
        // Iris with gradient
        const irisGrad = ctx.createRadialGradient(-s * 0.015, -s * 0.015, 0, 0, 0, s * 0.09);
        irisGrad.addColorStop(0, `rgba(${colors.eyeColor[0] + 80}, ${colors.eyeColor[1] + 80}, ${colors.eyeColor[2] + 50}, ${baseOpacity * 1.2})`);
        irisGrad.addColorStop(0.4, `rgba(${colors.eyeColor[0]}, ${colors.eyeColor[1]}, ${colors.eyeColor[2]}, ${baseOpacity * 1.2})`);
        irisGrad.addColorStop(1, `rgba(${colors.eyeColor[0] - 50}, ${colors.eyeColor[1] - 50}, ${colors.eyeColor[2] - 50}, ${baseOpacity * 1.2})`);

        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.075, s * 0.07 * eyeOpen, 0, 0, Math.PI * 2);
        ctx.fillStyle = irisGrad;
        ctx.fill();

        // Vertical slit pupil
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.02 * pupilSize, s * 0.055 * eyeOpen, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(10, 10, 15, ${baseOpacity * 1.3})`;
        ctx.fill();

        // Large anime highlight
        ctx.beginPath();
        ctx.ellipse(-s * 0.03, -s * 0.025 * eyeOpen, s * 0.03, s * 0.025, -0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${baseOpacity * 1.5})`;
        ctx.fill();

        // Secondary highlight
        ctx.beginPath();
        ctx.arc(s * 0.02, s * 0.015 * eyeOpen, s * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${baseOpacity * 1.0})`;
        ctx.fill();
      }

      // Eyelid/rim
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.105, s * 0.095 * eyeOpen, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${colors.eyeRim[0]}, ${colors.eyeRim[1]}, ${colors.eyeRim[2]}, ${baseOpacity * 0.8})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();

      // === NOSE (small triangle) ===
      ctx.save();
      ctx.translate(s * 0.2, s * 0.04);

      ctx.beginPath();
      ctx.moveTo(0, -s * 0.02);
      ctx.lineTo(-s * 0.025, s * 0.015);
      ctx.lineTo(s * 0.025, s * 0.015);
      ctx.closePath();

      const noseGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.03);
      noseGrad.addColorStop(0, `rgba(${colors.nose[0] + 40}, ${colors.nose[1] + 30}, ${colors.nose[2] + 30}, ${baseOpacity * 1.1})`);
      noseGrad.addColorStop(1, `rgba(${colors.nose[0]}, ${colors.nose[1]}, ${colors.nose[2]}, ${baseOpacity})`);
      ctx.fillStyle = noseGrad;
      ctx.fill();

      // Nose highlight
      ctx.beginPath();
      ctx.ellipse(-s * 0.006, -s * 0.008, s * 0.01, s * 0.006, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${baseOpacity * 0.4})`;
      ctx.fill();

      ctx.restore();

      // === MOUTH ===
      ctx.strokeStyle = `rgba(${colors.furDark[0]}, ${colors.furDark[1]}, ${colors.furDark[2]}, ${baseOpacity * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';

      // Mouth line down from nose
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.06);
      ctx.lineTo(s * 0.2, s * 0.09);
      ctx.stroke();

      // Curved smile
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.09);
      ctx.quadraticCurveTo(s * 0.15, s * 0.12, s * 0.1, s * 0.08);
      ctx.stroke();

      // === WHISKERS ===
      const whiskerOffset = cat.whiskerTwitch * Math.sin(time * 8) * 0.08;

      ctx.strokeStyle = `rgba(${colors.furLight[0] + 80}, ${colors.furLight[1] + 80}, ${colors.furLight[2] + 80}, ${baseOpacity * 0.7})`;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';

      for (let i = 0; i < 3; i++) {
        const baseAngle = 0.1 + i * 0.18 + whiskerOffset;
        const length = s * (0.3 - i * 0.025);

        ctx.beginPath();
        ctx.moveTo(s * 0.15, s * (0.05 + i * 0.018));
        ctx.quadraticCurveTo(
          s * 0.15 + Math.cos(baseAngle) * length * 0.5,
          s * (0.05 + i * 0.018) + Math.sin(baseAngle) * length * 0.5,
          s * 0.15 + Math.cos(baseAngle) * length,
          s * (0.05 + i * 0.018) + Math.sin(baseAngle) * length
        );
        ctx.stroke();
      }

      ctx.restore(); // head
      ctx.restore(); // main transform
    };

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;
      const cat = catRef.current;
      const obj = objectRef.current;

      if (!cat || !obj) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      // Update tail physics
      updateTailSegments(cat);

      // Update object
      obj.changeTimer -= 1;
      obj.wobbleY = obj.type === 'butterfly' ? 0 : Math.sin(timeRef.current * 2) * 4;

      if (obj.type === 'butterfly' || obj.type === 'laser') {
        // Erratic movement (less frequent)
        if (Math.random() < 0.01) {
          obj.direction *= -1;
        }
      }

      obj.x += obj.speed * obj.direction;

      // Respawn object when off screen
      if ((obj.direction > 0 && obj.x > canvas.width + 100) ||
          (obj.direction < 0 && obj.x < -100)) {
        const newObj = createObject(canvas);
        objectRef.current = newObj;
      }

      // Calculate distance to object
      const dx = obj.x - cat.x;
      const distance = Math.abs(dx);

      // Update cat state and blinking
      cat.stateTimer -= 1;
      cat.blinkTimer -= 1;

      // Smooth blink
      if (cat.blinkTimer <= 0) {
        if (cat.blinkState > 0.9) {
          cat.blinkTimer = 8;
        } else {
          cat.blinkTimer = 180 + Math.random() * 250;
        }
      }

      if (cat.blinkTimer < 8 && cat.blinkTimer > 4) {
        cat.blinkState = Math.max(0.05, cat.blinkState - 0.25);
      } else if (cat.blinkTimer <= 4) {
        cat.blinkState = Math.min(1, cat.blinkState + 0.25);
      }

      // Update ear twitches (smooth, occasional)
      if (Math.random() < 0.005) {
        cat.earTwitchTarget = (Math.random() - 0.5) * 2;
      }
      cat.earTwitchTarget *= 0.98; // Decay back to neutral

      // State machine
      if (cat.stateTimer <= 0) {
        if (cat.energy < 15) {
          cat.state = 'tired';
          cat.stateTimer = 250 + Math.random() * 150;
          cat.pupilDilateTarget = 0.5;
          cat.targetHeadTilt = 0;
        } else if (cat.state === 'tired' && cat.energy > 70) {
          cat.state = 'sitting';
          cat.stateTimer = 100 + Math.random() * 80;
          cat.pupilDilateTarget = 0.8;
        } else if (cat.state === 'sitting' || cat.state === 'thinking') {
          if (distance < 150 && cat.energy > 40) {
            cat.state = 'pouncing';
            cat.stateTimer = 25;
            cat.pupilDilateTarget = 1.3;
            cat.targetHeadTilt = -0.08;
          } else if (distance < 350 && cat.energy > 50) {
            cat.state = 'stalking';
            cat.stateTimer = 150 + Math.random() * 100;
            cat.pupilDilateTarget = 0.4;
            cat.targetHeadTilt = 0.12;
          } else if (distance < 600 && cat.energy > 60) {
            cat.state = 'chasing';
            cat.stateTimer = 180 + Math.random() * 120;
            cat.pupilDilateTarget = 0.9;
            cat.targetHeadTilt = 0;
          } else {
            cat.state = 'thinking';
            cat.stateTimer = 100 + Math.random() * 120;
            cat.targetHeadTilt = (Math.random() - 0.5) * 0.15;
          }
          cat.whiskerTwitch = 0.3 + Math.random() * 0.3;
        } else if (cat.state === 'chasing' || cat.state === 'stalking' || cat.state === 'pouncing') {
          cat.state = 'thinking';
          cat.stateTimer = 80 + Math.random() * 100;
          cat.pupilDilateTarget = 0.8;
          cat.targetHeadTilt = 0;
        }
      }

      // Movement based on state
      cat.direction = dx > 0 ? 1 : -1;

      switch (cat.state) {
        case 'chasing':
          cat.speed = 2.5;
          cat.energy -= 0.08;
          cat.walkPhase += 0.2;
          break;
        case 'stalking':
          cat.speed = 0.8;
          cat.energy -= 0.02;
          cat.walkPhase += 0.08;
          break;
        case 'pouncing':
          cat.speed = 5;
          cat.energy -= 0.35;
          cat.walkPhase += 0.35;
          break;
        case 'thinking':
          cat.speed = 0;
          cat.energy += 0.05;
          break;
        case 'sitting':
          cat.speed = 0;
          cat.energy += 0.08;
          break;
        case 'tired':
          cat.speed = 0;
          cat.energy += 0.15;
          break;
      }

      cat.energy = Math.max(0, Math.min(100, cat.energy));
      cat.x += cat.speed * cat.direction;

      // Keep cat on screen
      const margin = cat.size;
      cat.x = Math.max(margin, Math.min(canvas.width - margin, cat.x));

      // Decay effects
      cat.whiskerTwitch *= 0.97;

      // Draw
      drawObject(obj, opacityMultiplier);
      drawCat(cat, opacityMultiplier);

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, active, createCat, createObject]);
}
