import { apiUrl } from '@/lib/api';
import { httpJson, type HttpJsonInit } from '@/lib/http';

export function organizerHeaders(
  organizerCode: string,
): Record<string, string> {
  return {
    'X-Organizer-Code': organizerCode.trim(),
  };
}

export async function organizerJson<T>(
  path: string,
  organizerCode: string,
  init: HttpJsonInit = {},
): Promise<T> {
  const code = organizerCode.trim();
  if (!code) throw new Error('Missing organizer code.');

  return await httpJson<T>(apiUrl(path), {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...organizerHeaders(code),
    },
  });
}
