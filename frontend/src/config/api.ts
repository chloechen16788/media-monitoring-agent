const rawBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();

export const API_BASE = (rawBase && rawBase.length > 0 ? rawBase : 'http://localhost:3000').replace(
  /\/+$/,
  ''
);

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE.endsWith('/api') && normalized === '/api') {
    return API_BASE;
  }
  if (API_BASE.endsWith('/api') && normalized.startsWith('/api/')) {
    return `${API_BASE}${normalized.slice('/api'.length)}`;
  }
  return `${API_BASE}${normalized}`;
}

// ==========================================
// 鉴权 token：登录后存 localStorage，fetch 自动注入 Authorization。
// ==========================================
const TOKEN_KEY = 'auth_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

let authErrorHandler: (() => void) | null = null;
export function setAuthErrorHandler(fn: (() => void) | null): void {
  authErrorHandler = fn;
}

function isApiRequest(url: string): boolean {
  return url.startsWith(API_BASE) || url.startsWith('/api') || url.includes('/api/');
}

/** Patch window.fetch once so every API call carries the bearer token. */
export function installAuthFetch(): void {
  const w = window as unknown as { __authFetchInstalled?: boolean };
  if (w.__authFetchInstalled) return;
  w.__authFetchInstalled = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const token = getAuthToken();
    let nextInit = init;
    if (token && isApiRequest(url)) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      nextInit = { ...init, headers };
    }
    const res = await orig(input, nextInit);
    if (res.status === 401 && isApiRequest(url)) {
      setAuthToken(null);
      if (authErrorHandler) authErrorHandler();
    }
    return res;
  };
}

/** Build an authed download URL usable directly in an <a href> (token via query). */
export function downloadUrl(
  sessionId: string,
  filename: string,
  opts: { userId?: string | null; projectId?: string | null } = {}
): string {
  const base = apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/download/${encodeURIComponent(filename)}`);
  const params = new URLSearchParams();
  if (opts.userId) params.set('userId', opts.userId);
  if (opts.projectId) params.set('projectId', opts.projectId);
  const token = getAuthToken();
  if (token) params.set('token', token);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
