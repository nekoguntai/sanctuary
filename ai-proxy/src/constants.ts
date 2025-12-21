/**
 * AI Proxy Constants
 *
 * Configuration constants for the AI proxy service
 */

// Rate limiting configuration
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || '60000'); // 1 minute default
export const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.AI_RATE_LIMIT_MAX_REQUESTS || '10'); // 10 requests per minute default

// AI request timeout
export const AI_REQUEST_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '30000'); // 30 seconds default
