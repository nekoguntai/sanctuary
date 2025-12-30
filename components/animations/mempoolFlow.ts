/**
 * Mempool Flow Animation
 * Transactions flowing like water through channels representing the Bitcoin mempool.
 * Particles represent transactions waiting to be confirmed.
 */

import { useEffect, useRef } from 'react';

interface Transaction {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  hue: number;
  channel: number;
  confirmed: boolean;
  confirmProgress: number;
}

interface Channel {
  y: number;
  width: number;
  speed: number;
  waveOffset: number;
}

interface Block {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  transactions: number;
  filling: boolean;
  full: boolean;
}

export function useMempoolFlow(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const transactionsRef = useRef<Transaction[]>([]);
  const channelsRef = useRef<Channel[]>([]);
  const blocksRef = useRef<Block[]>([]);
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
      initializeChannels();
      initializeTransactions();
    };

    const initializeChannels = () => {
      channelsRef.current = [];
      const channelCount = 5;
      const spacing = canvas.height / (channelCount + 1);

      for (let i = 0; i < channelCount; i++) {
        channelsRef.current.push({
          y: spacing * (i + 1),
          width: 30 + Math.random() * 40,
          speed: 0.8 + Math.random() * 0.6,
          waveOffset: Math.random() * Math.PI * 2,
        });
      }

      // Initialize blocks on the right side
      blocksRef.current = [];
      for (let i = 0; i < 3; i++) {
        blocksRef.current.push({
          x: canvas.width - 80 - i * 90,
          y: canvas.height * 0.2,
          width: 70,
          height: canvas.height * 0.6,
          opacity: 0.1 + i * 0.15,
          transactions: 0,
          filling: i === 0,
          full: false,
        });
      }
    };

    const initializeTransactions = () => {
      transactionsRef.current = [];
      const txCount = Math.floor((canvas.width * canvas.height) / 15000);

      for (let i = 0; i < txCount; i++) {
        transactionsRef.current.push(createTransaction(true));
      }
    };

    const createTransaction = (randomX = false): Transaction => {
      const channelIndex = Math.floor(Math.random() * channelsRef.current.length);
      const channel = channelsRef.current[channelIndex];

      return {
        x: randomX ? Math.random() * canvas.width * 0.7 : -20,
        y: channel.y + (Math.random() - 0.5) * channel.width * 0.8,
        size: 4 + Math.random() * 8,
        speed: channel.speed * (0.8 + Math.random() * 0.4),
        opacity: 0.5 + Math.random() * 0.4,
        hue: 25 + Math.random() * 30, // Orange to yellow (Bitcoin colors)
        channel: channelIndex,
        confirmed: false,
        confirmProgress: 0,
      };
    };

    const drawChannel = (channel: Channel, index: number, opacityMult: number, time: number) => {
      const waveAmplitude = 5;
      const waveFrequency = 0.01;

      // Draw flowing channel
      ctx.beginPath();

      // Top edge with wave
      for (let x = 0; x <= canvas.width; x += 10) {
        const waveY = Math.sin(x * waveFrequency + time * 0.002 + channel.waveOffset) * waveAmplitude;
        const y = channel.y - channel.width / 2 + waveY;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Bottom edge with wave (reverse)
      for (let x = canvas.width; x >= 0; x -= 10) {
        const waveY = Math.sin(x * waveFrequency + time * 0.002 + channel.waveOffset + Math.PI) * waveAmplitude;
        const y = channel.y + channel.width / 2 + waveY;
        ctx.lineTo(x, y);
      }

      ctx.closePath();

      // Channel gradient
      const gradient = ctx.createLinearGradient(0, channel.y - channel.width / 2, 0, channel.y + channel.width / 2);
      const channelColor = darkMode
        ? { r: 40, g: 80, b: 120 }
        : { r: 100, g: 160, b: 220 };

      gradient.addColorStop(0, `rgba(${channelColor.r}, ${channelColor.g}, ${channelColor.b}, ${0.1 * opacityMult})`);
      gradient.addColorStop(0.5, `rgba(${channelColor.r + 20}, ${channelColor.g + 20}, ${channelColor.b + 20}, ${0.2 * opacityMult})`);
      gradient.addColorStop(1, `rgba(${channelColor.r}, ${channelColor.g}, ${channelColor.b}, ${0.1 * opacityMult})`);

      ctx.fillStyle = gradient;
      ctx.fill();
    };

    const drawTransaction = (tx: Transaction, opacityMult: number) => {
      const alpha = tx.opacity * opacityMult;

      // Transaction glow
      const gradient = ctx.createRadialGradient(tx.x, tx.y, 0, tx.x, tx.y, tx.size * 2);
      gradient.addColorStop(0, `hsla(${tx.hue}, 90%, 60%, ${alpha})`);
      gradient.addColorStop(0.5, `hsla(${tx.hue}, 80%, 50%, ${alpha * 0.5})`);
      gradient.addColorStop(1, `hsla(${tx.hue}, 70%, 40%, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(tx.x, tx.y, tx.size * 2, 0, Math.PI * 2);
      ctx.fill();

      // Transaction core
      ctx.fillStyle = `hsla(${tx.hue}, 100%, 70%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(tx.x, tx.y, tx.size * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Confirmation animation
      if (tx.confirmed && tx.confirmProgress < 1) {
        ctx.strokeStyle = `hsla(120, 80%, 50%, ${(1 - tx.confirmProgress) * alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx.x, tx.y, tx.size + tx.confirmProgress * 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const drawBlock = (block: Block, opacityMult: number, time: number) => {
      const blockColor = darkMode
        ? { r: 60, g: 100, b: 60 }
        : { r: 80, g: 140, b: 80 };

      // Block outline
      ctx.strokeStyle = `rgba(${blockColor.r + 40}, ${blockColor.g + 40}, ${blockColor.b + 40}, ${block.opacity * opacityMult})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(block.x, block.y, block.width, block.height);

      // Fill level based on transactions
      const fillLevel = Math.min(1, block.transactions / 50);
      const fillHeight = block.height * fillLevel;

      if (fillHeight > 0) {
        const gradient = ctx.createLinearGradient(block.x, block.y + block.height - fillHeight, block.x, block.y + block.height);
        gradient.addColorStop(0, `rgba(${blockColor.r + 60}, ${blockColor.g + 80}, ${blockColor.b + 60}, ${block.opacity * opacityMult * 0.5})`);
        gradient.addColorStop(1, `rgba(${blockColor.r}, ${blockColor.g}, ${blockColor.b}, ${block.opacity * opacityMult * 0.7})`);

        ctx.fillStyle = gradient;
        ctx.fillRect(block.x + 2, block.y + block.height - fillHeight, block.width - 4, fillHeight - 2);
      }

      // Block number indicator
      if (block.full) {
        ctx.fillStyle = `rgba(100, 200, 100, ${block.opacity * opacityMult})`;
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('FULL', block.x + block.width / 2, block.y + block.height / 2);
      }
    };

    const drawFlowLines = (opacityMult: number, time: number) => {
      // Draw flowing lines toward blocks
      const lineColor = darkMode
        ? `rgba(100, 150, 200, ${0.1 * opacityMult})`
        : `rgba(80, 130, 180, ${0.1 * opacityMult})`;

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;

      for (let i = 0; i < 20; i++) {
        const y = (canvas.height / 20) * i + Math.sin(time * 0.001 + i) * 10;
        const startX = 0;
        const endX = canvas.width - 100;

        ctx.beginPath();
        ctx.moveTo(startX, y);

        // Curved flow line
        const cp1x = canvas.width * 0.3;
        const cp1y = y + Math.sin(time * 0.002 + i * 0.5) * 20;
        const cp2x = canvas.width * 0.6;
        const cp2y = y - Math.sin(time * 0.002 + i * 0.3) * 20;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, canvas.height / 2);
        ctx.stroke();
      }
    };

    const animate = () => {
      timeRef.current += 16;
      const time = timeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const opacityMult = opacity / 50;

      // Draw flow lines (background)
      drawFlowLines(opacityMult, time);

      // Draw channels
      channelsRef.current.forEach((channel, index) => {
        drawChannel(channel, index, opacityMult, time);
      });

      // Draw blocks
      blocksRef.current.forEach((block) => {
        drawBlock(block, opacityMult, time);
      });

      // Get the active filling block
      const fillingBlock = blocksRef.current.find(b => b.filling && !b.full);

      // Update and draw transactions
      transactionsRef.current.forEach((tx, index) => {
        const channel = channelsRef.current[tx.channel];

        // Add wave motion to Y position
        const waveY = Math.sin(tx.x * 0.01 + time * 0.002 + channel.waveOffset) * 3;
        tx.y = channel.y + (tx.y - channel.y) * 0.98 + waveY * 0.02;

        tx.x += tx.speed;

        // Check if transaction reaches block area
        if (fillingBlock && tx.x > fillingBlock.x - 20 && !tx.confirmed) {
          tx.confirmed = true;
          fillingBlock.transactions++;

          if (fillingBlock.transactions >= 50) {
            fillingBlock.full = true;
            fillingBlock.filling = false;

            // Start filling next block
            const nextBlock = blocksRef.current.find(b => !b.filling && !b.full);
            if (nextBlock) {
              nextBlock.filling = true;
            }
          }
        }

        // Update confirmation animation
        if (tx.confirmed) {
          tx.confirmProgress += 0.05;
          tx.opacity *= 0.95;

          if (tx.confirmProgress >= 1) {
            // Reset transaction
            transactionsRef.current[index] = createTransaction(false);
            return;
          }
        }

        // Reset if off screen
        if (tx.x > canvas.width + 20) {
          transactionsRef.current[index] = createTransaction(false);
          return;
        }

        drawTransaction(tx, opacityMult);
      });

      // Reset blocks periodically
      if (blocksRef.current.every(b => b.full)) {
        blocksRef.current.forEach((block, i) => {
          block.transactions = 0;
          block.full = false;
          block.filling = i === 0;
        });
      }

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
