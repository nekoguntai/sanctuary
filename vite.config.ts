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
          '@shared': path.resolve(__dirname, './shared'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              // Hardware wallet SDKs - separate chunks for lazy loading
              if (id.includes('@trezor/')) {
                return 'hw-trezor';
              }
              if (id.includes('@ledgerhq/') || id.includes('ledger-bitcoin')) {
                return 'hw-ledger';
              }
              if (id.includes('@keystonehq/')) {
                return 'hw-keystone';
              }
              if (id.includes('@ngraveio/')) {
                return 'hw-ngrave';
              }
              // Bitcoin libraries
              if (id.includes('bitcoinjs-lib') || id.includes('bip174') || id.includes('ecpair') || id.includes('@bitcoinerlab/')) {
                return 'bitcoin';
              }
              // Charts - keep in main bundle to avoid initialization issues
              // if (id.includes('recharts') || id.includes('d3-')) {
              //   return 'charts';
              // }
              // React core
              if (id.includes('react-dom') || id.includes('react-router')) {
                return 'react-vendor';
              }
              // Data fetching
              if (id.includes('@tanstack/react-query')) {
                return 'query';
              }
            },
          },
        },
      },
    };
});
