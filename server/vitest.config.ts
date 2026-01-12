import { defineConfig } from 'vitest/config';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['tests/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, 'tests/setup.ts')],
    testTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,
    // JUnit reporter for CI
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/index.ts'],
      thresholds: {
        // Thresholds updated after adding labels.ts and price.ts tests (2026-01-11)
        // Current coverage: branches=47.23%, functions=51.83%, lines=52.81%, statements=52.71%
        branches: 47,
        functions: 51,
        lines: 52,
        statements: 52,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
