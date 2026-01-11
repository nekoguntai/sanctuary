import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
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
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      include: ['hooks/**/*.ts', 'components/**/*.tsx', 'utils/**/*.ts', 'contexts/**/*.tsx'],
      reportsDirectory: './coverage',
      thresholds: {
        // Thresholds increased after Tier 2 & 3 test coverage improvements (2026-01-11)
        branches: 20,
        functions: 22,
        lines: 25,
        statements: 25,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
  },
});
