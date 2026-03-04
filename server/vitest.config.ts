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
        // Coverage baseline locked to current observed total coverage (2026-03-04).
        // Remaining gaps are v8 arrow-function artifacts in delegate methods.
        branches: 99,
        functions: 99,
        lines: 99,
        statements: 99,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@fixtures': path.resolve(__dirname, './tests/fixtures'),
    },
  },
});
