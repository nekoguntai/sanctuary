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
        // Thresholds set to current levels - increase as coverage improves
        branches: 20,
        functions: 15,
        lines: 15,
        statements: 15,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
