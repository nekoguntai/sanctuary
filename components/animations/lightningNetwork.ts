/**
 * Lightning Network Animation
 * Nodes connected by electric bolts representing the Bitcoin Lightning Network.
 * Pulses of energy travel between nodes showing payment channels.
 */

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  radius: number;
  pulsePhase: number;
  connections: number[];
  brightness: number;
  targetBrightness: number;
}

interface Channel {
  from: number;
  to: number;
  active: boolean;
  pulsePosition: number;
  pulseDirection: number;
  boltPoints: { x: number; y: number }[];
  lastBoltUpdate: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

export function useLightningNetwork(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const nodesRef = useRef<Node[]>([]);
  const channelsRef = useRef<Channel[]>([]);
  const sparksRef = useRef<Spark[]>([]);
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
      initializeNetwork();
    };

    const initializeNetwork = () => {
      nodesRef.current = [];
      channelsRef.current = [];

      // Create nodes in a distributed pattern
      const nodeCount = Math.floor((canvas.width * canvas.height) / 40000) + 8;
      const minDistance = 120;

      for (let i = 0; i < nodeCount; i++) {
        let x: number, y: number;
        let attempts = 0;
        let valid = false;

        // Find position not too close to other nodes
        do {
          x = 50 + Math.random() * (canvas.width - 100);
          y = 50 + Math.random() * (canvas.height - 100);
          valid = true;

          for (const node of nodesRef.current) {
            const dist = Math.hypot(x - node.x, y - node.y);
            if (dist < minDistance) {
              valid = false;
              break;
            }
          }
          attempts++;
        } while (!valid && attempts < 50);

        if (valid || attempts >= 50) {
          nodesRef.current.push({
            x,
            y,
            radius: 6 + Math.random() * 6,
            pulsePhase: Math.random() * Math.PI * 2,
            connections: [],
            brightness: 0.5 + Math.random() * 0.3,
            targetBrightness: 0.5 + Math.random() * 0.3,
          });
        }
      }

      // Create channels between nearby nodes
      const maxChannelDist = 250;
      nodesRef.current.forEach((node, i) => {
        nodesRef.current.forEach((otherNode, j) => {
          if (i >= j) return;

          const dist = Math.hypot(node.x - otherNode.x, node.y - otherNode.y);
          if (dist < maxChannelDist && Math.random() < 0.6) {
            node.connections.push(j);
            otherNode.connections.push(i);

            channelsRef.current.push({
              from: i,
              to: j,
              active: false,
              pulsePosition: 0,
              pulseDirection: 1,
              boltPoints: generateBoltPoints(node, otherNode),
              lastBoltUpdate: 0,
            });
          }
        });
      });
    };

    const generateBoltPoints = (from: Node, to: Node): { x: number; y: number }[] => {
      const points: { x: number; y: number }[] = [];
      const segments = 8 + Math.floor(Math.random() * 6);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy);
      const perpX = -dy / dist;
      const perpY = dx / dist;

      points.push({ x: from.x, y: from.y });

      for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const baseX = from.x + dx * t;
        const baseY = from.y + dy * t;
        const offset = (Math.random() - 0.5) * 30 * Math.sin(t * Math.PI);
        points.push({
          x: baseX + perpX * offset,
          y: baseY + perpY * offset,
        });
      }

      points.push({ x: to.x, y: to.y });
      return points;
    };

    const createSparks = (x: number, y: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        sparksRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          maxLife: 20 + Math.random() * 20,
          size: 1 + Math.random() * 2,
        });
      }
    };

    const drawNode = (node: Node, index: number, opacityMult: number, time: number) => {
      const pulse = Math.sin(time * 0.003 + node.pulsePhase) * 0.2 + 0.8;
      const glowRadius = node.radius * 2.5 * pulse;

      // Outer glow
      const gradient = ctx.createRadialGradient(
        node.x, node.y, 0,
        node.x, node.y, glowRadius
      );

      const baseColor = darkMode
        ? { r: 255, g: 200, b: 50 }  // Golden yellow
        : { r: 255, g: 170, b: 0 };  // Orange gold

      gradient.addColorStop(0, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${0.8 * node.brightness * opacityMult})`);
      gradient.addColorStop(0.5, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${0.3 * node.brightness * opacityMult})`);
      gradient.addColorStop(1, 'rgba(255, 200, 50, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Core
      ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * opacityMult})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius * 0.6, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawChannel = (channel: Channel, opacityMult: number, time: number) => {
      const fromNode = nodesRef.current[channel.from];
      const toNode = nodesRef.current[channel.to];

      // Update bolt points periodically for active channels
      if (channel.active && time - channel.lastBoltUpdate > 50) {
        channel.boltPoints = generateBoltPoints(fromNode, toNode);
        channel.lastBoltUpdate = time;
      }

      const baseAlpha = channel.active ? 0.7 : 0.15;
      const color = darkMode
        ? `rgba(100, 180, 255, ${baseAlpha * opacityMult})`
        : `rgba(50, 130, 220, ${baseAlpha * opacityMult})`;

      ctx.strokeStyle = color;
      ctx.lineWidth = channel.active ? 2 : 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw jagged lightning bolt
      ctx.beginPath();
      ctx.moveTo(channel.boltPoints[0].x, channel.boltPoints[0].y);
      for (let i = 1; i < channel.boltPoints.length; i++) {
        ctx.lineTo(channel.boltPoints[i].x, channel.boltPoints[i].y);
      }
      ctx.stroke();

      // Draw pulse traveling along channel
      if (channel.active) {
        const pulseIndex = Math.floor(channel.pulsePosition * (channel.boltPoints.length - 1));
        const nextIndex = Math.min(pulseIndex + 1, channel.boltPoints.length - 1);
        const t = (channel.pulsePosition * (channel.boltPoints.length - 1)) % 1;

        const pulseX = channel.boltPoints[pulseIndex].x + (channel.boltPoints[nextIndex].x - channel.boltPoints[pulseIndex].x) * t;
        const pulseY = channel.boltPoints[pulseIndex].y + (channel.boltPoints[nextIndex].y - channel.boltPoints[pulseIndex].y) * t;

        // Pulse glow
        const pulseGradient = ctx.createRadialGradient(pulseX, pulseY, 0, pulseX, pulseY, 20);
        pulseGradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * opacityMult})`);
        pulseGradient.addColorStop(0.3, `rgba(100, 200, 255, ${0.6 * opacityMult})`);
        pulseGradient.addColorStop(1, 'rgba(100, 200, 255, 0)');

        ctx.fillStyle = pulseGradient;
        ctx.beginPath();
        ctx.arc(pulseX, pulseY, 20, 0, Math.PI * 2);
        ctx.fill();

        // Update pulse position
        channel.pulsePosition += 0.02 * channel.pulseDirection;

        // Create sparks at pulse position occasionally
        if (Math.random() < 0.1) {
          createSparks(pulseX, pulseY, 2);
        }

        // Pulse reached end
        if (channel.pulsePosition >= 1 || channel.pulsePosition <= 0) {
          const targetNode = channel.pulseDirection > 0
            ? nodesRef.current[channel.to]
            : nodesRef.current[channel.from];

          targetNode.targetBrightness = 1;
          createSparks(targetNode.x, targetNode.y, 8);

          // Randomly decide next action
          if (Math.random() < 0.7) {
            channel.pulseDirection *= -1;
            channel.pulsePosition = channel.pulseDirection > 0 ? 0 : 1;
          } else {
            channel.active = false;
          }
        }
      }
    };

    const drawSpark = (spark: Spark, opacityMult: number) => {
      const alpha = spark.life * opacityMult;
      ctx.fillStyle = `rgba(255, 255, 200, ${alpha})`;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * spark.life, 0, Math.PI * 2);
      ctx.fill();
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const opacityMult = opacity / 50;

      // Randomly activate channels
      if (Math.random() < 0.02) {
        const inactiveChannels = channelsRef.current.filter(c => !c.active);
        if (inactiveChannels.length > 0) {
          const channel = inactiveChannels[Math.floor(Math.random() * inactiveChannels.length)];
          channel.active = true;
          channel.pulsePosition = Math.random() < 0.5 ? 0 : 1;
          channel.pulseDirection = channel.pulsePosition === 0 ? 1 : -1;
          channel.lastBoltUpdate = time;

          // Light up source node
          const sourceNode = channel.pulseDirection > 0
            ? nodesRef.current[channel.from]
            : nodesRef.current[channel.to];
          sourceNode.targetBrightness = 1;
          createSparks(sourceNode.x, sourceNode.y, 5);
        }
      }

      // Draw channels (behind nodes)
      channelsRef.current.forEach((channel) => {
        drawChannel(channel, opacityMult, time);
      });

      // Draw nodes
      nodesRef.current.forEach((node, index) => {
        // Fade brightness back to normal
        node.brightness += (node.targetBrightness - node.brightness) * 0.05;
        if (node.brightness > 0.8) {
          node.targetBrightness = 0.5 + Math.random() * 0.3;
        }

        drawNode(node, index, opacityMult, time);
      });

      // Update and draw sparks
      sparksRef.current = sparksRef.current.filter((spark) => {
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.vy += 0.05; // Gravity
        spark.life -= 1 / spark.maxLife;

        if (spark.life <= 0) return false;

        drawSpark(spark, opacityMult);
        return true;
      });

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
