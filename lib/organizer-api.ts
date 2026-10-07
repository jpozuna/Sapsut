import { apiUrl } from '@/lib/api';
import { httpJson, type HttpJsonInit } from '@/lib/http';
import { withOrganizerToken } from '@/lib/organizer-session';

export function organizerHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
  };
}

/**
 * Call an organizer route with the stored session token. Nothing is sent when
 * there is no session, and a 401 clears the session (back to participant).
 *
 * The three-argument form `(path, code, init)` is kept for screens that still
 * pass an organizer code; the code is ignored and never sent.
 */
export async function organizerJson<T>(
  path: string,
  init?: HttpJsonInit,
): Promise<T>;
/** @deprecated The code argument is ignored; use `(path, init)`. */
export async function organizerJson<T>(
  path: string,
  legacyOrganizerCode: string,
  init?: HttpJsonInit,
): Promise<T>;
export async function organizerJson<T>(
  path: string,
  second?: string | HttpJsonInit,
  third?: HttpJsonInit,
): Promise<T> {
  const init: HttpJsonInit =
    (typeof second === 'string' ? third : second) ?? {};

  return await withOrganizerToken((token) =>
    httpJson<T>(apiUrl(path), {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...organizerHeaders(token),
      },
    }),
  );
}
