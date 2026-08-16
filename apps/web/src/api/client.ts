import type { ApiErrorResponse } from '@cinedrive/shared';
import { t } from '../i18n';

/**
 * A thin `fetch` wrapper standing in for axios, which was 11% of the initial
 * JavaScript bundle for a feature set this app never used: no interceptors, no
 * cancellation, no transforms — just JSON in, JSON out, with cookies.
 *
 * The `{ data }` return shape is deliberate, so every call site and the
 * `vi.spyOn(apiClient, 'get')` in the tests stay unchanged.
 */

const baseURL = import.meta.env.VITE_API_URL || '/api';

/** Matches the timeout axios was configured with. */
const REQUEST_TIMEOUT_MS = 15_000;

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorResponse | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** A 204 and an empty error body both have to survive `JSON.parse`. */
const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestConfig {
  params?: QueryParams;
  timeoutMs?: number;
}

/** Same rule axios applied: `undefined` and `null` values are left out. */
const buildQuery = (params?: QueryParams) => {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
};

const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
  config?: RequestConfig,
): Promise<{ data: T }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config?.timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseURL}${path}${buildQuery(config?.params)}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await readBody(response);

    if (!response.ok) {
      const errorBody = (payload ?? null) as ApiErrorResponse | null;
      throw new ApiRequestError(
        response.status,
        errorBody,
        errorBody?.error?.message || response.statusText || t.errors.networkError,
      );
    }

    return { data: payload as T };
  } catch (error) {
    // An abort here is our own timeout firing, not an answer from the server.
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError(0, null, t.errors.networkError);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const apiClient = {
  get: <T = unknown>(path: string, config?: RequestConfig) =>
    request<T>('GET', path, undefined, config),
  post: <T = unknown>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>('POST', path, body, config),
  put: <T = unknown>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>('PUT', path, body, config),
  patch: <T = unknown>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>('PATCH', path, body, config),
  delete: <T = unknown>(path: string, config?: RequestConfig) =>
    request<T>('DELETE', path, undefined, config),
};

export interface FormattedApiError {
  code: string;
  message: string;
  requestId?: string;
  status: number;
}

export function parseApiError(error: unknown): FormattedApiError {
  if (error instanceof ApiRequestError) {
    const errorData = error.body?.error;

    return {
      code: errorData?.code || 'UNKNOWN_ERROR',
      message: errorData?.message || error.message || t.errors.networkError,
      requestId: errorData?.requestId,
      status: error.status || 500,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : t.errors.unexpected,
    status: 500,
  };
}
