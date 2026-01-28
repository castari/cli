import {
  CastariError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  BadRequestError,
  ServerError,
} from './errors.js';
import type { ApiErrorResponse } from './types.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface HttpClientOptions {
  baseUrl: string;
  authType?: 'api_key' | 'token';
  authValue?: string;
}

/**
 * HTTP client for making API requests
 */
export class HttpClient {
  private baseUrl: string;
  private authType?: 'api_key' | 'token';
  private authValue?: string;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authType = options.authType;
    this.authValue = options.authValue;
  }

  /**
   * Set authentication credentials
   */
  setAuth(type: 'api_key' | 'token', value: string): void {
    this.authType = type;
    this.authValue = value;
  }

  /**
   * Set the base URL for API requests
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Make an HTTP request to the API
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      timeout?: number;
    }
  ): Promise<T> {
    const url = new URL(`/api/v1${path}`, this.baseUrl);

    // Add query parameters
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Add auth header (both token and api_key use Bearer format)
    if (this.authValue) {
      headers['Authorization'] = `Bearer ${this.authValue}`;
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = options?.timeout ?? 120000; // Default 2 minutes
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle no-content responses
      if (response.status === 204) {
        return undefined as T;
      }

      // Parse response body
      const contentType = response.headers.get('content-type');
      let data: unknown;
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // Handle errors
      if (!response.ok) {
        this.handleError(response.status, data, response.headers);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof CastariError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new CastariError('Request timed out');
        }
        throw new CastariError(`Request failed: ${error.message}`);
      }

      throw new CastariError('An unexpected error occurred');
    }
  }

  /**
   * Make a multipart form-data request for file uploads
   */
  async requestMultipart<T>(
    method: HttpMethod,
    path: string,
    formData: FormData,
    options?: {
      query?: Record<string, string | number | boolean | undefined>;
      timeout?: number;
    }
  ): Promise<T> {
    const url = new URL(`/api/v1${path}`, this.baseUrl);

    // Add query parameters
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    // Build headers - don't set Content-Type, let fetch handle it for FormData
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    // Add auth header
    if (this.authValue) {
      headers['Authorization'] = `Bearer ${this.authValue}`;
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = options?.timeout ?? 300000; // Default 5 minutes for uploads
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle no-content responses
      if (response.status === 204) {
        return undefined as T;
      }

      // Parse response body
      const contentType = response.headers.get('content-type');
      let data: unknown;
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // Handle errors
      if (!response.ok) {
        this.handleError(response.status, data, response.headers);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof CastariError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new CastariError('Upload timed out');
        }
        throw new CastariError(`Upload failed: ${error.message}`);
      }

      throw new CastariError('An unexpected error occurred');
    }
  }

  /**
   * Handle HTTP error responses
   */
  private handleError(status: number, data: unknown, headers: Headers): never {
    const errorResponse = data as ApiErrorResponse;
    const message = errorResponse?.detail || 'An error occurred';

    switch (status) {
      case 400:
        throw new BadRequestError(message);
      case 401:
        throw new AuthenticationError(message);
      case 404:
        throw new NotFoundError(message);
      case 422:
        throw new ValidationError(message);
      case 429: {
        const retryAfter = headers.get('Retry-After');
        throw new RateLimitError(
          message,
          retryAfter ? parseInt(retryAfter, 10) : undefined
        );
      }
      case 500:
      case 502:
      case 503:
      case 504:
        throw new ServerError(message);
      default:
        throw new CastariError(message, { statusCode: status });
    }
  }
}
