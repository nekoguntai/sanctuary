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
        // Thresholds updated after comprehensive test coverage implementation (2026-01-11)
        // Current coverage: branches=42.74%, functions=43.7%, lines=46.8%, statements=47.54%
        branches: 40,
        functions: 40,
        lines: 45,
        statements: 45,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
  },
});
