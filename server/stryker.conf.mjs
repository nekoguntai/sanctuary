/**
 * Stryker Mutation Testing Configuration
 *
 * Mutation testing verifies test quality by making small code changes (mutations)
 * and checking if tests detect them. A high mutation score means tests are effective
 * at catching bugs.
 *
 * Focus: Bitcoin address derivation - the most critical code path where bugs = lost funds
 *
 * KNOWN ISSUE: Stryker vitest-runner 8.x has compatibility issues with Vitest 4.x.
 * When this is fixed upstream, mutation testing will work automatically.
 * Track: https://github.com/stryker-mutator/stryker-js/issues
 *
 * Alternative: Use @stryker-mutator/vitest-runner@latest when available, or
 * wait for Stryker 9.x release which supports Vitest 4.x.
 *
 * Usage (when working):
 *   npm run test:mutation           # Run full mutation testing
 *   npm run test:mutation -- --incremental  # Run incrementally (faster for CI)
 */

/** @type {import('@stryker-mutator/api').PartialStrykerOptions} */
export default {
  // Focus mutation testing on the most critical Bitcoin code
  mutate: [
    'src/services/bitcoin/addressDerivation.ts',
    'src/services/bitcoin/descriptorParser.ts',
    'src/services/bitcoin/descriptorBuilder.ts',
    'src/services/scriptTypes/**/*.ts',
    // Exclude type definitions and index files
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],

  // Test files that verify the mutated code
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },

  // TypeScript checking to filter out invalid mutations
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',

  // Mutator configuration - all mutation operators
  mutator: {
    // Focus on operators most likely to reveal bugs in address derivation
    excludedMutations: [
      // Skip string literal mutations (address prefixes are intentional)
      // 'StringLiteral',
    ],
  },

  // Timeouts
  timeoutMS: 60000, // Individual test timeout
  timeoutFactor: 2.5, // Multiplier for slow tests

  // Reporting
  reporters: ['html', 'clear-text', 'progress', 'json'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation-report.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation-report.json',
  },

  // Performance
  concurrency: 4, // Parallel mutation testing
  incremental: true, // Cache results between runs
  incrementalFile: '.stryker-cache/incremental.json',

  // Thresholds for CI enforcement
  thresholds: {
    high: 90, // Green badge
    low: 80, // Yellow badge
    break: 75, // Fail CI if below this
  },

  // Disable coverage analysis for speed (we have separate coverage)
  coverageAnalysis: 'perTest',

  // Dashboard reporting (optional - for Stryker dashboard)
  // dashboard: {
  //   project: 'sanctuary',
  //   version: 'main',
  // },

  // Logging
  logLevel: 'info',

  // Disable sandbox for speed (mutations are isolated by test runner)
  disableTypeChecks: false,
};
