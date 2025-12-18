/**
 * Simple structured logger for the gateway
 */

import { config } from '../config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[config.logLevel as LogLevel] ?? LOG_LEVELS.info;

function formatTimestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevel;
}

export function createLogger(module: string) {
  const prefix = `[${module}]`;

  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog('debug')) {
        console.log(`[${formatTimestamp()}] DEBUG ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog('info')) {
        console.log(`[${formatTimestamp()}] INFO  ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog('warn')) {
        console.warn(`[${formatTimestamp()}] WARN  ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog('error')) {
        console.error(`[${formatTimestamp()}] ERROR ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
  };
}
