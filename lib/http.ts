import type { AppError } from '@/lib/app-error';
import { isAppError, toAppError } from '@/lib/app-error';

export type HttpJsonInit = RequestInit & {
  headers?: Record<string, string>;
};

export async function httpJson<T>(
  url: string,
  init: HttpJsonInit = {},
): Promise<T> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const status = res.status;
      let message: string | undefined;
      try {
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const body = (await res.json()) as unknown;
          if (typeof body === 'string') message = body;
          else if (
            typeof body === 'object' &&
            body !== null &&
            'message' in body &&
            typeof (body as { message?: unknown }).message === 'string'
          ) {
            message = (body as { message: string }).message;
          }
        } else {
          const text = await res.text();
          if (text.trim()) message = text;
        }
      } catch {
        // ignore body parse errors
      }

      const err: AppError = {
        kind: status >= 500 ? 'server' : 'unknown',
        status,
        message,
        cause: { url },
      };
      throw err;
    }

    return (await res.json()) as T;
  } catch (err) {
    if (isAppError(err)) throw err;
    throw toAppError(err);
  }
}
