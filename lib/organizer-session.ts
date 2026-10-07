import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { apiUrl } from '@/lib/api';
import type { AppError } from '@/lib/app-error';
import { isAppError } from '@/lib/app-error';
import { httpJson } from '@/lib/http';

/**
 * Organizer session. The organizer code is exchanged once for a 24h
 * server-signed token (`POST /organizer/session`); only the token and its
 * expiry are kept. The code itself is never stored.
 *
 * - Native: `{ token, expiresAt }` lives in `expo-secure-store`.
 * - Web: the token is held in memory only (lost on reload) and is never
 *   written to `localStorage`.
 */

const SESSION_KEY = 'sapsut.organizerSession.v1';
// Pre-token builds persisted the plaintext code here. It is deleted on launch.
const LEGACY_CODE_KEY = 'sapsut.organizerCode.v1';

const IS_WEB = Platform.OS === 'web';

export type OrganizerSession = { token: string; expiresAt: number };

export type SessionCheck = 'valid' | 'invalid' | 'unreachable';

// In-memory copy. The only storage on web; a cache in front of SecureStore on
// native. `loaded` avoids re-reading SecureStore on every request.
let memorySession: OrganizerSession | null = null;
let loaded = IS_WEB;
// Bumped on every save/clear so a slow initial SecureStore read can tell that
// the session changed while it was in flight and must not overwrite it.
let sessionVersion = 0;
let loadPromise: Promise<void> | null = null;

// SecureStore writes and deletes run strictly in call order, so a late delete
// of an expired entry can never land after a newer save.
let storageQueue: Promise<void> = Promise.resolve();
function enqueueStorage(op: () => Promise<void>): Promise<void> {
  const next = storageQueue.then(op, op);
  storageQueue = next.catch(() => {});
  return next;
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

const REQUEST_TIMEOUT_MS = 10_000;

function isExpired(session: OrganizerSession): boolean {
  return !(session.expiresAt > Date.now());
}

function parseStored(raw: string | null): OrganizerSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const { token, expiresAt } = v as { token?: unknown; expiresAt?: unknown };
    if (typeof token !== 'string' || !token.trim()) return null;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
      return null;
    }
    return { token, expiresAt };
  } catch {
    return null;
  }
}

function deleteStored(): Promise<void> {
  if (IS_WEB) return Promise.resolve();
  return enqueueStorage(async () => {
    try {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    } catch {
      // Best-effort; the in-memory copy is already cleared.
    }
  });
}

/** Delete the plaintext organizer code that older builds kept in AsyncStorage. */
export async function removeLegacyOrganizerCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_CODE_KEY);
  } catch {
    // ignore
  }
}

async function loadFromStorage(): Promise<void> {
  const versionAtStart = sessionVersion;
  let stored: OrganizerSession | null = null;
  try {
    stored = parseStored(await SecureStore.getItemAsync(SESSION_KEY));
  } catch {
    stored = null;
  }
  // A session saved or cleared while the read was in flight is newer than
  // whatever the read returned; keep it.
  if (sessionVersion === versionAtStart) memorySession = stored;
  loaded = true;
}

/**
 * Current non-expired session, or null. An expired entry is treated as absent
 * and deleted.
 */
export async function getOrganizerSession(): Promise<OrganizerSession | null> {
  if (!loaded) {
    loadPromise ??= loadFromStorage().finally(() => {
      loadPromise = null;
    });
    await loadPromise;
  }
  if (memorySession && isExpired(memorySession)) {
    memorySession = null;
    sessionVersion += 1;
    void deleteStored();
  }
  return memorySession;
}

export async function getOrganizerToken(): Promise<string | null> {
  return (await getOrganizerSession())?.token ?? null;
}

async function saveOrganizerSession(session: OrganizerSession): Promise<void> {
  memorySession = session;
  loaded = true;
  sessionVersion += 1;
  if (IS_WEB) return;
  try {
    await enqueueStorage(() =>
      SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    );
  } catch {
    // The session still works for this run; it just will not survive a restart.
  }
}

export async function clearOrganizerSession(): Promise<void> {
  memorySession = null;
  loaded = true;
  sessionVersion += 1;
  await deleteStored();
}

/** Register a callback fired when a request proves the stored token is dead. */
export function onOrganizerUnauthorized(
  listener: UnauthorizedListener,
): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(): void {
  unauthorizedListeners.forEach((fn) => fn());
}

/**
 * Call when an organizer request got a 401. Drops the stored token and tells
 * listeners (the role context) to fall back to participant. `usedToken` is the
 * token the failed request carried; if the session has since been replaced
 * (the user signed in again), the late 401 is ignored. Returns whether the
 * session was dropped.
 */
export async function handleOrganizerUnauthorized(
  usedToken: string,
): Promise<boolean> {
  if (memorySession && memorySession.token !== usedToken) return false;
  const clearing = clearOrganizerSession();
  // Memory is already null here, so listeners can react without waiting for
  // the SecureStore delete.
  notifyUnauthorized();
  await clearing;
  return true;
}

function sessionRequiredError(): AppError {
  return {
    kind: 'unknown',
    status: 401,
    message: 'Organizer session expired. Sign in again.',
  };
}

/**
 * Run an organizer request with the stored token. Throws before any network
 * call when there is no session (or it expired), so participants never hit
 * organizer routes. In that case, and on any 401 from the server, the session
 * is dropped and the app switches to participant.
 */
export async function withOrganizerToken<T>(
  run: (token: string) => Promise<T>,
): Promise<T> {
  const token = await getOrganizerToken();
  if (!token) {
    notifyUnauthorized();
    throw sessionRequiredError();
  }
  try {
    return await run(token);
  } catch (err) {
    if (isAppError(err) && err.status === 401) {
      await handleOrganizerUnauthorized(token);
    }
    throw err;
  }
}

/**
 * `httpJson` with an abort timeout. A timeout surfaces as a `network`
 * AppError, so callers treat it like an unreachable server.
 */
async function sessionRequest<T>(
  init: Parameters<typeof httpJson>[1],
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    return await httpJson<T>(apiUrl('/organizer/session'), {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      const timeout: AppError = {
        kind: 'network',
        message: 'The request timed out.',
        cause: err,
      };
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function signInError(err: unknown): AppError {
  const status = isAppError(err) ? err.status : undefined;
  if (status === 401) {
    return { kind: 'unknown', status, message: 'Incorrect organizer code.' };
  }
  if (status === 429) {
    return {
      kind: 'unknown',
      status,
      message: 'Too many attempts. Try again in a few minutes.',
    };
  }
  if (isAppError(err) && err.kind === 'network') {
    return {
      kind: 'network',
      message: "Couldn't reach the server. Check your connection and retry.",
    };
  }
  return {
    kind: 'server',
    status,
    message: 'Organizer sign-in failed. Try again in a moment.',
  };
}

/**
 * Exchange the organizer code for a session token. Only `X-Organizer-Code` is
 * sent (the server rejects any Bearer header here). An existing session is
 * left alone until the exchange succeeds, then replaced. Throws an AppError
 * with a user-facing message; the code is never kept.
 */
export async function signInWithOrganizerCode(code: string): Promise<void> {
  const trimmed = (code ?? '').trim();

  let res: { token?: unknown; expires_at?: unknown };
  try {
    res = await sessionRequest<{ token?: unknown; expires_at?: unknown }>({
      method: 'POST',
      headers: { 'X-Organizer-Code': trimmed },
    });
  } catch (err) {
    throw signInError(err);
  }

  const expiresAt =
    typeof res.expires_at === 'string' ? Date.parse(res.expires_at) : NaN;
  if (
    typeof res.token !== 'string' ||
    !res.token ||
    !Number.isFinite(expiresAt)
  ) {
    throw signInError(undefined);
  }
  await saveOrganizerSession({ token: res.token, expiresAt });
}

/**
 * Ask the server whether a restored token is still good. Only a 401 means the
 * token is dead; network or server errors leave it in place because the server
 * still authorizes every call. A timeout counts as unreachable.
 */
export async function verifyOrganizerSession(
  token: string,
): Promise<SessionCheck> {
  try {
    await sessionRequest<unknown>({
      headers: { Authorization: `Bearer ${token}` },
    });
    return 'valid';
  } catch (err) {
    if (isAppError(err) && err.status === 401) return 'invalid';
    return 'unreachable';
  }
}
