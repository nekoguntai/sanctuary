/**
 * API Client
 *
 * Base HTTP client for communicating with the Sanctuary backend API.
 * Handles authentication, error handling, and request/response formatting.
 *
 * Features:
 * - Automatic retry with exponential backoff for network errors and 5xx responses
 * - Configurable retry behavior per request
 * - Token-based authentication
 */

// Retry configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

// Retryable HTTP status codes (server errors)
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  // Set to false to disable retry for specific requests
  enabled?: boolean;
}

/**
 * Sleep for specified milliseconds with jitter
 */
const sleep = (ms: number): Promise<void> => {
  // Add ±20% jitter to prevent thundering herd
  const jitter = ms * 0.2 * (Math.random() - 0.5);
  return new Promise(resolve => setTimeout(resolve, ms + jitter));
};

/**
 * Check if an error is retryable
 */
const isRetryableError = (error: unknown, status?: number): boolean => {
  // Network errors (status 0) are retryable
  if (status === 0) return true;

  // Server errors are retryable
  if (status && RETRYABLE_STATUS_CODES.includes(status)) return true;

  // TypeError usually indicates network failure
  if (error instanceof TypeError) return true;

  return false;
};

// Auto-detect API URL based on current host
const getApiBaseUrl = (): string => {
  // If VITE_API_URL is set, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Otherwise, use relative URL (assumes nginx proxy at /api/v1)
  // This works for both development (with proxy) and production (Docker nginx)
  return '/api/v1';
};

const API_BASE_URL = getApiBaseUrl();

// Export for use by functions that need direct fetch (e.g., file downloads)
export { API_BASE_URL };

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private token: string | null = null;

  constructor() {
    // Load token from localStorage on initialization
    this.token = localStorage.getItem('sanctuary_token');
  }

  /**
   * Set authentication token
   */
  setToken(token: string | null): void {
    this.token = token;
    if (token) {
      localStorage.setItem('sanctuary_token', token);
    } else {
      localStorage.removeItem('sanctuary_token');
    }
  }

  /**
   * Get current token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.token;
  }

  /**
   * Make HTTP request with automatic retry for transient failures
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOptions: RetryOptions = {}
  ): Promise<T> {
    const {
      maxRetries = DEFAULT_MAX_RETRIES,
      initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
      maxDelayMs = DEFAULT_MAX_DELAY_MS,
      backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
      enabled: retryEnabled = true,
    } = retryOptions;

    const url = `${API_BASE_URL}${endpoint}`;

    // Set default headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    // Add authentication token if available
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let lastError: ApiError | null = null;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
        });

        // Handle non-JSON responses (like 204 No Content)
        if (response.status === 204) {
          return {} as T;
        }

        const data = await response.json();

        // Handle error responses
        if (!response.ok) {
          const error = new ApiError(
            data.message || `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            data
          );

          // Check if this error is retryable
          if (retryEnabled && isRetryableError(error, response.status) && attempt < maxRetries) {
            lastError = error;
            const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
            console.warn(`[API] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, {
              endpoint,
              status: response.status,
            });
            await sleep(delay);
            attempt++;
            continue;
          }

          throw error;
        }

        return data as T;
      } catch (error) {
        if (error instanceof ApiError) {
          // Already handled above for retryable errors
          throw error;
        }

        // Network or other errors
        const apiError = new ApiError(
          error instanceof Error ? error.message : 'Network error',
          0
        );

        // Check if this network error is retryable
        if (retryEnabled && isRetryableError(error, 0) && attempt < maxRetries) {
          lastError = apiError;
          const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
          console.warn(`[API] Network error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, {
            endpoint,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          await sleep(delay);
          attempt++;
          continue;
        }

        throw apiError;
      }
    }

    // Should not reach here, but just in case
    throw lastError || new ApiError('Request failed after all retries', 0);
  }

  /**
   * GET request
   * @param endpoint API endpoint
   * @param params Query parameters
   * @param retryOptions Optional retry configuration
   */
  async get<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | string[] | undefined | null>,
    retryOptions?: RetryOptions
  ): Promise<T> {
    // Build query string
    let url = endpoint;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return this.request<T>(url, { method: 'GET' }, retryOptions);
  }

  /**
   * POST request
   * @param endpoint API endpoint
   * @param data Request body
   * @param options Additional options (headers, retry config)
   */
  async post<T>(
    endpoint: string,
    data?: unknown,
    options?: { headers?: Record<string, string>; retry?: RetryOptions }
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
        headers: options?.headers,
      },
      options?.retry
    );
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: unknown, retryOptions?: RetryOptions): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined,
      },
      retryOptions
    );
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, data?: unknown, retryOptions?: RetryOptions): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'PATCH',
        body: data ? JSON.stringify(data) : undefined,
      },
      retryOptions
    );
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, data?: unknown, retryOptions?: RetryOptions): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'DELETE',
        ...(data && { body: JSON.stringify(data) }),
      },
      retryOptions
    );
  }

  /**
   * Upload file (multipart/form-data) with retry support
   */
  async upload<T>(endpoint: string, formData: FormData, retryOptions: RetryOptions = {}): Promise<T> {
    const {
      maxRetries = DEFAULT_MAX_RETRIES,
      initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
      maxDelayMs = DEFAULT_MAX_DELAY_MS,
      backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
      enabled: retryEnabled = true,
    } = retryOptions;

    const url = `${API_BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {};

    // Add authentication token if available
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let lastError: ApiError | null = null;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          const error = new ApiError(
            data.message || `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            data
          );

          if (retryEnabled && isRetryableError(error, response.status) && attempt < maxRetries) {
            lastError = error;
            const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
            console.warn(`[API] Upload failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
            await sleep(delay);
            attempt++;
            continue;
          }

          throw error;
        }

        return data as T;
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        const apiError = new ApiError(
          error instanceof Error ? error.message : 'Network error',
          0
        );

        if (retryEnabled && isRetryableError(error, 0) && attempt < maxRetries) {
          lastError = apiError;
          const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
          console.warn(`[API] Upload network error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
          await sleep(delay);
          attempt++;
          continue;
        }

        throw apiError;
      }
    }

    throw lastError || new ApiError('Upload failed after all retries', 0);
  }
}

// Export RetryOptions for use by other modules
export type { RetryOptions };

// Singleton instance
const apiClient = new ApiClient();

export default apiClient;
