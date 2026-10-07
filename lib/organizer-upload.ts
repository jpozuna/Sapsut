import { apiUrl } from '@/lib/api';
import type { AppError } from '@/lib/app-error';
import { toAppError } from '@/lib/app-error';
import { organizerHeaders } from '@/lib/organizer-api';
import { withOrganizerToken } from '@/lib/organizer-session';

/** Flatten any `HeadersInit` (plain object, tuple array, `Headers`) to a record. */
function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    h.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(h)) {
    for (const [key, value] of h) out[key] = value;
  } else {
    Object.assign(out, h);
  }
  return out;
}

/** Turn a FastAPI `detail` (string, or a 422 array of `{ loc, msg }`) into text. */
function detailToMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          const { msg } = item as { msg?: unknown };
          if (typeof msg === 'string') return msg;
        }
        return '';
      })
      .filter(Boolean)
      .join('; ');
  }
  return '';
}

/**
 * Upload multipart data to an organizer route with the stored session token.
 *
 * The four-argument form `(path, code, formData, init)` is kept for screens
 * that still pass an organizer code; the code is ignored and never sent.
 */
export async function organizerUploadJson<T>(
  path: string,
  formData: FormData,
  init?: RequestInit,
): Promise<T>;
/** @deprecated The code argument is ignored; use `(path, formData, init)`. */
export async function organizerUploadJson<T>(
  path: string,
  legacyOrganizerCode: string,
  formData: FormData,
  init?: RequestInit,
): Promise<T>;
export async function organizerUploadJson<T>(
  path: string,
  second: string | FormData,
  third?: FormData | RequestInit,
  fourth?: RequestInit,
): Promise<T> {
  const formData = (typeof second === 'string' ? third : second) as FormData;
  const init =
    (typeof second === 'string'
      ? fourth
      : (third as RequestInit | undefined)) ?? {};

  return await withOrganizerToken(async (token) => {
    const url = apiUrl(path);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        method: init.method ?? 'POST',
        headers: {
          ...headersToRecord(init.headers),
          accept: 'application/json',
          ...organizerHeaders(token),
          // NOTE: do not set Content-Type for FormData in React Native
        },
        body: formData,
      });
    } catch (err) {
      // fetch rejects on connection failures; surface them as AppErrors.
      throw toAppError(err);
    }

    const body = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      const detail =
        body && typeof body === 'object' && 'detail' in body
          ? detailToMessage((body as { detail?: unknown }).detail)
          : '';
      const err: AppError = {
        kind: res.status >= 500 ? 'server' : 'unknown',
        status: res.status,
        message: detail || 'Upload failed.',
        cause: { url },
      };
      throw err;
    }
    if (!body) {
      const err: AppError = {
        kind: 'server',
        status: res.status,
        message: 'Upload failed.',
        cause: { url },
      };
      throw err;
    }
    return body;
  });
}
