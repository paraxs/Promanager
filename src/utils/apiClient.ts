export const API_KEY_STORAGE_KEY = 'promanager-api-key';

const normalizeApiBaseUrl = (value: string | undefined): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
};

const getApiBaseUrl = (): string => normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export const toApiUrl = (path: string): string => {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
};

export const readStoredApiKey = (): string => {
  try {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(API_KEY_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
};

export const writeStoredApiKey = (value: string): void => {
  try {
    if (typeof window === 'undefined') return;
    const normalized = value.trim();
    if (normalized) {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
};

export const buildApiAuthHeaders = (): Record<string, string> => {
  const apiKey = readStoredApiKey();
  return apiKey ? { 'x-promanager-api-key': apiKey } : {};
};

export const apiFetch = (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers ?? {});
  const authHeaders = buildApiAuthHeaders();
  for (const [key, value] of Object.entries(authHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  return fetch(toApiUrl(path), {
    ...init,
    headers,
  });
};
