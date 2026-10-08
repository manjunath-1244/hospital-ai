export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const TOKEN_KEY = 'curaai.token';
const USER_KEY = 'curaai.user';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/* ---- token storage (localStorage, never throws) ---- */
export function readStored(key: 'token' | 'user'): string | null {
  try {
    return localStorage.getItem(key === 'token' ? TOKEN_KEY : USER_KEY);
  } catch {
    return null;
  }
}
export function writeStored(token: string | null, userJson: string | null) {
  try {
    if (token && userJson) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, userJson);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    /* storage unavailable */
  }
}

let currentToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setApiToken(token: string | null) {
  currentToken = token;
}
export function getApiToken(): string | null {
  return currentToken;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const m = (body as { message?: unknown; error?: unknown }).message;
    if (Array.isArray(m)) return m.join('; ');
    if (typeof m === 'string') return m;
    const e = (body as { error?: unknown }).error;
    if (typeof e === 'string') return e;
  }
  return fallback;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  skipAuthRedirect?: boolean;
  signal?: AbortSignal;
}

async function rawFetch(path: string, opts: ApiOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // browser sets multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(
      0,
      `Unable to reach the API at ${API_URL}. Is the backend running?`,
    );
  }
}

export async function apiFetch<T>(
  path: string,
  opts: ApiOptions = {},
): Promise<T> {
  const res = await rawFetch(path, opts);
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.skipAuthRedirect) unauthorizedHandler?.();
    throw new ApiError(
      res.status,
      extractMessage(parsed, res.statusText || `HTTP ${res.status}`),
      parsed,
    );
  }
  return parsed as T;
}

/** Fetch a binary resource with auth and return an object URL (caller must revoke). */
export async function apiFetchBlobUrl(path: string): Promise<string> {
  const res = await rawFetch(path, {});
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    throw new ApiError(res.status, res.statusText || `HTTP ${res.status}`);
  }
  return URL.createObjectURL(await res.blob());
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export function newId(): string {
  return crypto.randomUUID();
}
