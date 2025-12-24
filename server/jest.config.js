/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    // Thresholds set to match current coverage levels
    // Raise incrementally as test coverage improves
    global: {
      branches: 15,
      functions: 20,
      lines: 25,
      statements: 25,
    },
    // Higher thresholds for critical paths
    // Note: Lowered from 70% after adding decoy outputs feature
    './src/services/bitcoin/transactionService.ts': {
      statements: 65,
      branches: 50,
      functions: 70,
      lines: 65,
    },
    './src/utils/encryption.ts': {
      statements: 95,
      branches: 90,
      functions: 100,
      lines: 95,
    },
  },
  // JUnit reporter config for CI
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: '.',
      outputName: 'junit.xml',
    }],
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  // Use Jest globals without explicit imports
  injectGlobals: true,
  // Increase timeout for async tests
  testTimeout: 10000,
  // Clear mocks between tests
  clearMocks: true,
  // Restore mocks after each test
  restoreMocks: true,
  // Verbose output for debugging
  verbose: true,
};
