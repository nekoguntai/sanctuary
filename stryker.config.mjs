/**
 * Stryker Mutation Testing Configuration
 *
 * Run with: npm run test:mutation
 *
 * Mutation testing helps verify that your tests actually catch bugs
 * by introducing small changes (mutations) to your code and checking
 * if tests fail.
 */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  coverageAnalysis: 'perTest',

  // Focus on critical files for mutation testing
  mutate: [
    'hooks/**/*.ts',
    'utils/**/*.ts',
    'shared/**/*.ts',
    '!**/*.test.ts',
    '!**/*.d.ts',
  ],

  // Thresholds for mutation score
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },

  // Timeout for individual tests
  timeoutMS: 10000,

  // Exclude slow or problematic tests
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    '.git',
  ],
};
