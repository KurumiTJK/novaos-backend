// ═══════════════════════════════════════════════════════════════════════════════
// E2E TEST UTILITIES — Shared Test Helpers
// NovaOS Testing — E2E & Load Testing Support
// ═══════════════════════════════════════════════════════════════════════════════
//
// Common utilities for E2E and load testing:
//   - HTTP request helpers
//   - Test user creation
//   - Authenticated client factory
//   - Timing utilities
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Test user with authentication token.
 */
export interface TestUser {
  id: string;
  email: string;
  token: string;
  tier: 'free' | 'pro' | 'enterprise';
  createdAt: string;
}

/**
 * HTTP request options.
 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * HTTP response wrapper.
 */
export interface RequestResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
  latencyMs: number;
}

/**
 * Authenticated client interface.
 */
export interface AuthenticatedClient {
  get<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'token'>): Promise<RequestResponse<T>>;
  post<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'token' | 'body'>): Promise<RequestResponse<T>>;
  put<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'token' | 'body'>): Promise<RequestResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'token' | 'body'>): Promise<RequestResponse<T>>;
  delete<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'token'>): Promise<RequestResponse<T>>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// HTTP REQUEST HELPER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Make an HTTP request with timing and error handling.
 */
export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<RequestResponse<T>> {
  const {
    method = 'GET',
    token,
    body,
    headers = {},
    timeout = 30000,
  } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const latencyMs = performance.now() - startTime;
    clearTimeout(timeoutId);

    // Parse response
    let data: T;
    const contentType = response.headers.get('content-type') ?? '';
    
    if (contentType.includes('application/json')) {
      data = await response.json() as T;
    } else {
      data = await response.text() as unknown as T;
    }

    // Extract headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      data,
      headers: responseHeaders,
      latencyMs,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = performance.now() - startTime;

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        status: 0,
        data: { error: 'Request timeout' } as T,
        headers: {},
        latencyMs,
      };
    }

    return {
      status: 0,
      data: { error: error instanceof Error ? error.message : 'Unknown error' } as T,
      headers: {},
      latencyMs,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// TEST USER CREATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a test user via the API.
 */
export async function createTestUser(
  baseUrl: string,
  email: string,
  tier: 'free' | 'pro' | 'enterprise' = 'free'
): Promise<TestUser> {
  const response = await request<{ user: TestUser; token: string }>(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    body: { email, tier },
  });

  if (response.status !== 200 && response.status !== 201) {
    // If registration fails (user exists), try to login
    const loginResponse = await request<{ user: TestUser; token: string }>(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { email },
    });

    if (loginResponse.status !== 200) {
      throw new Error(`Failed to create/login test user: ${JSON.stringify(loginResponse.data)}`);
    }

    return {
      ...loginResponse.data.user,
      token: loginResponse.data.token,
    };
  }

  return {
    ...response.data.user,
    token: response.data.token,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED CLIENT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create an authenticated HTTP client for a test user.
 */
export function createAuthenticatedClient(baseUrl: string, user: TestUser): AuthenticatedClient {
  const makeRequest = async <T>(
    method: RequestOptions['method'],
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, 'method' | 'token' | 'body'> = {}
  ): Promise<RequestResponse<T>> => {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    return request<T>(url, {
      ...options,
      method,
      token: user.token,
      body,
    });
  };

  return {
    get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'token'>) =>
      makeRequest<T>('GET', path, undefined, options),
    
    post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'token' | 'body'>) =>
      makeRequest<T>('POST', path, body, options),
    
    put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'token' | 'body'>) =>
      makeRequest<T>('PUT', path, body, options),
    
    patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'token' | 'body'>) =>
      makeRequest<T>('PATCH', path, body, options),
    
    delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'token'>) =>
      makeRequest<T>('DELETE', path, undefined, options),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIMING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Wait for a specified number of milliseconds.
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait until a condition is true or timeout.
 */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<boolean> {
  const { timeout = 10000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await wait(interval);
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────────
// STRING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a random string of specified length.
 */
export function randomString(length: number = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random email address.
 */
export function randomEmail(domain: string = 'test.example.com'): string {
  return `test_${randomString(10)}@${domain}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ASSERTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a response is successful (2xx).
 */
export function assertSuccess<T>(response: RequestResponse<T>, message?: string): asserts response is RequestResponse<T> & { status: 200 | 201 | 204 } {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      message ?? `Expected success response, got ${response.status}: ${JSON.stringify(response.data)}`
    );
  }
}

/**
 * Assert that a response has a specific status.
 */
export function assertStatus<T>(response: RequestResponse<T>, expectedStatus: number, message?: string): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      message ?? `Expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(response.data)}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// CLEANUP UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Track created resources for cleanup.
 */
export class ResourceTracker {
  private resources: Array<{ type: string; id: string; cleanup: () => Promise<void> }> = [];

  track(type: string, id: string, cleanup: () => Promise<void>): void {
    this.resources.push({ type, id, cleanup });
  }

  async cleanupAll(): Promise<void> {
    const errors: Error[] = [];

    // Cleanup in reverse order (LIFO)
    for (const resource of this.resources.reverse()) {
      try {
        await resource.cleanup();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.resources = [];

    if (errors.length > 0) {
      console.warn(`Cleanup errors: ${errors.map(e => e.message).join(', ')}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// RETRY UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Retry a function until it succeeds or max attempts reached.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { maxAttempts = 3, delay = 1000, backoff = 2 } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxAttempts) {
        await wait(delay * Math.pow(backoff, attempt - 1));
      }
    }
  }

  throw lastError ?? new Error('Retry failed');
}
