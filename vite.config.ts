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
            global: true,
          },
        }),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@shared': path.resolve(__dirname, './shared'),
        }
      },
      optimizeDeps: {
        // Pre-bundle regenerator-runtime to ensure it's available
        include: ['regenerator-runtime/runtime'],
      },
      build: {
        rollupOptions: {
          // Ensure regenerator-runtime is treated as external-facing code
          output: {
            // Preserve module execution order
            preserveModules: false,
          },
        },
        // Don't tree-shake regenerator-runtime side effects
        commonjsOptions: {
          include: [/regenerator-runtime/, /node_modules/],
          transformMixedEsModules: true,
        },
      },
    };
});
