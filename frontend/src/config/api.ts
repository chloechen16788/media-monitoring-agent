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
