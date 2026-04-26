function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return stripTrailingSlashes(fromEnv.trim());
  }

  // Default for local dev (e.g. iOS simulator). Override with EXPO_PUBLIC_API_BASE_URL.
  return 'http://localhost:8000';
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}
