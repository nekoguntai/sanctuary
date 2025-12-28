/**
 * Logger Tests
 *
 * Tests for the logging utility including automatic redaction
 * and error handling.
 */

// Unmock logger since we're testing the actual implementation
jest.unmock('../../../src/utils/logger');
jest.unmock('../../../src/utils/requestContext');
jest.unmock('../../../src/utils/redact');

import { createLogger, setLogLevel, getConfiguredLogLevel, LogLevel } from '../../../src/utils/logger';

// Capture console.log output for testing
const originalConsoleLog = console.log;
let capturedLogs: string[] = [];

beforeAll(() => {
  console.log = (...args: any[]) => {
    capturedLogs.push(args.join(' '));
  };
});

afterAll(() => {
  console.log = originalConsoleLog;
});

beforeEach(() => {
  // Ensure debug level for tests
  setLogLevel('debug');
  // Clear logs AFTER setLogLevel so tests start fresh
  capturedLogs = [];
});

describe('Logger', () => {
  describe('createLogger', () => {
    it('should create a logger with the given prefix', () => {
      const log = createLogger('TEST');

      log.info('Test message');

      expect(capturedLogs[0]).toContain('[TEST]');
      expect(capturedLogs[0]).toContain('Test message');
    });

    it('should have all log level methods', () => {
      const log = createLogger('TEST');

      expect(log.debug).toBeDefined();
      expect(log.info).toBeDefined();
      expect(log.warn).toBeDefined();
      expect(log.error).toBeDefined();
    });
  });

  describe('log levels', () => {
    it('should log at debug level when set to debug', () => {
      const log = createLogger('TEST');

      log.debug('Debug message');

      expect(capturedLogs[0]).toContain('DEBUG');
      expect(capturedLogs[0]).toContain('Debug message');
    });

    it('should not log debug when set to info', () => {
      setLogLevel('info');
      capturedLogs = []; // Clear the log from setLogLevel
      const log = createLogger('TEST');

      log.debug('Debug message');

      expect(capturedLogs.length).toBe(0);
    });

    it('should always log errors regardless of level', () => {
      setLogLevel('error');
      capturedLogs = []; // Clear the log from setLogLevel
      const log = createLogger('TEST');

      log.debug('Debug message');
      log.info('Info message');
      log.warn('Warn message');
      log.error('Error message');

      expect(capturedLogs.length).toBe(1);
      expect(capturedLogs[0]).toContain('ERROR');
    });
  });

  describe('context formatting', () => {
    it('should format simple context as key=value', () => {
      const log = createLogger('TEST');

      log.info('Test', { key: 'value', num: 42 });

      expect(capturedLogs[0]).toContain('key=value');
      expect(capturedLogs[0]).toContain('num=42');
    });

    it('should handle null and undefined context values', () => {
      const log = createLogger('TEST');

      log.info('Test', { nullVal: null, undefVal: undefined });

      expect(capturedLogs[0]).toContain('nullVal=null');
      expect(capturedLogs[0]).toContain('undefVal=null');
    });

    it('should JSON stringify nested objects', () => {
      const log = createLogger('TEST');

      log.info('Test', { nested: { inner: 'value' } });

      expect(capturedLogs[0]).toContain('nested=');
      expect(capturedLogs[0]).toContain('"inner":"value"');
    });
  });

  describe('automatic redaction', () => {
    it('should redact password fields', () => {
      const log = createLogger('TEST');

      log.info('Login attempt', { username: 'john', password: 'secret123' });

      expect(capturedLogs[0]).toContain('username=john');
      expect(capturedLogs[0]).toContain('password=[REDACTED]');
      expect(capturedLogs[0]).not.toContain('secret123');
    });

    it('should redact token fields', () => {
      const log = createLogger('TEST');

      log.info('Auth request', { token: 'abc123', refreshToken: 'def456' });

      expect(capturedLogs[0]).toContain('token=[REDACTED]');
      expect(capturedLogs[0]).toContain('refreshToken=[REDACTED]');
      expect(capturedLogs[0]).not.toContain('abc123');
      expect(capturedLogs[0]).not.toContain('def456');
    });

    it('should redact API key fields', () => {
      const log = createLogger('TEST');

      log.info('API call', { apiKey: 'key123', api_secret: 'secret456' });

      expect(capturedLogs[0]).toContain('apiKey=[REDACTED]');
      expect(capturedLogs[0]).toContain('api_secret=[REDACTED]');
    });

    it('should redact Bitcoin-specific fields', () => {
      const log = createLogger('TEST');

      log.info('Wallet', {
        walletId: '123',
        xpub: 'xpub123...',
        xprv: 'xprv456...',
        mnemonic: 'word1 word2 word3',
        seed: 'seed phrase here',
      });

      expect(capturedLogs[0]).toContain('walletId=123');
      expect(capturedLogs[0]).toContain('xpub=[REDACTED]');
      expect(capturedLogs[0]).toContain('xprv=[REDACTED]');
      expect(capturedLogs[0]).toContain('mnemonic=[REDACTED]');
      expect(capturedLogs[0]).toContain('seed=[REDACTED]');
    });

    it('should redact nested sensitive fields', () => {
      const log = createLogger('TEST');

      log.info('Config', {
        database: {
          host: 'localhost',
          password: 'dbpass123',
        },
      });

      expect(capturedLogs[0]).toContain('host');
      expect(capturedLogs[0]).toContain('password');
      expect(capturedLogs[0]).toContain('[REDACTED]');
      expect(capturedLogs[0]).not.toContain('dbpass123');
    });
  });

  describe('error handling', () => {
    it('should safely format Error objects', () => {
      const log = createLogger('TEST');
      const error = new Error('Something went wrong');

      log.error('Operation failed', { error });

      expect(capturedLogs[0]).toContain('Something went wrong');
      expect(capturedLogs[0]).toContain('Error');
    });

    it('should handle TypeError', () => {
      const log = createLogger('TEST');
      const error = new TypeError('Invalid type');

      log.error('Type error', { error });

      expect(capturedLogs[0]).toContain('Invalid type');
      expect(capturedLogs[0]).toContain('TypeError');
    });

    it('should handle errors with sensitive data in message', () => {
      const log = createLogger('TEST');
      const error = new Error('Failed to connect with password');

      log.error('Connection failed', { error });

      // The error message itself is logged (can't auto-redact message content)
      // but the error object is safely formatted
      expect(capturedLogs[0]).toContain('Failed to connect');
    });

    it('should not include stack traces in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const log = createLogger('TEST');
      const error = new Error('Test error');

      log.error('Error occurred', { error });

      // Stack should not appear in production
      expect(capturedLogs[0]).not.toContain('at ');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('setLogLevel and getConfiguredLogLevel', () => {
    it('should change log level with string', () => {
      setLogLevel('warn');
      expect(getConfiguredLogLevel()).toBe('warn');
    });

    it('should change log level with enum', () => {
      setLogLevel(LogLevel.ERROR);
      expect(getConfiguredLogLevel()).toBe('error');
    });

    it('should accept all valid levels', () => {
      setLogLevel('debug');
      expect(getConfiguredLogLevel()).toBe('debug');

      setLogLevel('info');
      expect(getConfiguredLogLevel()).toBe('info');

      setLogLevel('warn');
      expect(getConfiguredLogLevel()).toBe('warn');

      setLogLevel('error');
      expect(getConfiguredLogLevel()).toBe('error');
    });
  });

  describe('timestamp format', () => {
    it('should include ISO timestamp', () => {
      const log = createLogger('TEST');

      log.info('Test message');

      // Should match ISO 8601 format
      expect(capturedLogs[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]/);
    });
  });

  describe('empty context', () => {
    it('should handle undefined context', () => {
      const log = createLogger('TEST');

      log.info('Test message');

      expect(capturedLogs[0]).toContain('Test message');
      expect(capturedLogs[0]).not.toContain('undefined');
    });

    it('should handle empty object context', () => {
      const log = createLogger('TEST');

      log.info('Test message', {});

      expect(capturedLogs[0]).toContain('Test message');
    });
  });

  describe('circular reference handling', () => {
    it('should handle circular references in context', () => {
      const log = createLogger('TEST');
      const obj: any = { name: 'test' };
      obj.self = obj;

      // This should not throw and should handle the circular reference
      expect(() => {
        log.info('Circular test', { data: obj });
      }).not.toThrow();

      expect(capturedLogs[0]).toContain('[Circular]');
    });
  });
});
