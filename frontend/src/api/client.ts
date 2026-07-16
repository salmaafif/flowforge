import { loadAuth } from '../auth/storage';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Minimal fetch wrapper: same-origin paths (the dev server proxies them to the
 * API), JSON in/out, and the Bearer token attached automatically when present.
 */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = loadAuth()?.accessToken;

  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') {
      return body.message;
    }
    if (Array.isArray(body.message)) {
      return body.message.join(', ');
    }
  } catch {
    // Fall through to the status text.
  }
  return response.statusText || `Request failed with status ${response.status}`;
}
