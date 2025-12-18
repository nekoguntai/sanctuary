import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        watch: {
          usePolling: true,
          interval: 1000,
        },
      },
      plugins: [
        react(),
        nodePolyfills({
          include: ['buffer', 'process', 'stream', 'util'],
          globals: {
            Buffer: true,
            process: true,
          },
        }),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
