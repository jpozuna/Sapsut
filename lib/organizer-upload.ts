import { apiUrl } from '@/lib/api';
import { organizerHeaders } from '@/lib/organizer-api';

export async function organizerUploadJson<T>(
  path: string,
  organizerCode: string,
  formData: FormData,
  init: RequestInit = {},
): Promise<T> {
  const code = organizerCode.trim();
  if (!code) throw new Error('Missing organizer code.');

  const res = await fetch(apiUrl(path), {
    ...init,
    method: init.method ?? 'POST',
    headers: {
      ...(init.headers ?? {}),
      accept: 'application/json',
      ...organizerHeaders(code),
      // NOTE: do not set Content-Type for FormData in React Native
    },
    body: formData,
  });

  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && body && 'detail' in body
        ? String((body as { detail?: unknown }).detail ?? '')
        : '';
    throw new Error(detail || 'Upload failed.');
  }
  if (!body) throw new Error('Upload failed.');
  return body;
}
