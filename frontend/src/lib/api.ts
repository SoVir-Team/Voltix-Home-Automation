/**
 * Tiny fetch wrapper for the Voltix API. Auth lives in httpOnly cookies; when the 15-minute access token
 * expires we refresh once (single flight) and retry, and send the user to /login if that fails.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const BASE = '/api/v1';

let refreshing: Promise<boolean> | null = null;

/** Exchange the refresh cookie for a new access token. Resolves false when the session is gone. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

let leaving = false;
async function toLogin() {
  if (typeof window === 'undefined' || leaving || window.location.pathname.startsWith('/login')) return;
  leaving = true;
  // Clears the session flag cookie too, so the route guard doesn't think we're still signed in.
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body, retry = true): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    void toLogin();
  }
  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => ({}))) as {
    error?: { code: string; message: string; details?: unknown };
  };
  if (!res.ok) {
    const e = data.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong', e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: Body = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: Body) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: Body) => request<T>('PUT', path, body),
  del: <T = void>(path: string, body?: Body) => request<T>('DELETE', path, body),
};

/** Human message for an error, with friendlier copy for the device errors people actually hit. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'DEVICE_OFFLINE':
        return 'That device is offline. Check its power and Wi-Fi.';
      case 'DEVICE_TIMEOUT':
        return "The device didn't answer in time. Try again.";
      case 'DEVICE_REJECTED':
        return err.message || 'The device refused the command.';
      case 'RATE_LIMITED':
        return 'Too many requests. Wait a moment and try again.';
      default:
        return err.message;
    }
  }
  if (err instanceof TypeError) return 'Network error. Check your connection.';
  return 'Something went wrong';
}
