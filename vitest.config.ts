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
        // Thresholds updated after Batch 1-3 test coverage implementation (2026-01-11)
        // Current coverage: branches=48.77%, functions=52.43%, lines=54.17%, statements=54.17%
        branches: 45,
        functions: 50,
        lines: 50,
        statements: 50,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
  },
});
