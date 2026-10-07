import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { apiUrl } from '@/lib/api';
import type { AppError } from '@/lib/app-error';
import { isAppError } from '@/lib/app-error';
import { httpJson, type HttpJsonInit } from '@/lib/http';

/**
 * Team session. A team joins once with its invite code (`POST /teams/join`)
 * and gets a 7-day server-signed token, sent as `X-Team-Token` on team routes.
 *
 * - Native: `{ teamId, teamName, token, expiresAt }` lives in
 *   `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
 * - Web: the same JSON lives in AsyncStorage (localStorage), so players do not
 *   rejoin on every reload. The token is team-scoped and expires in 7 days.
 *
 * Callers tell "no session" apart from other failures with
 * `isNoTeamSessionError(err)`.
 */

const SESSION_KEY = 'sapsut.teamSession.v1';
// Pre-session builds kept a raw team id here. Removed on first read.
const LEGACY_TEAM_ID_KEYS = [
  'sapsut.teamId.participant.v1',
  'sapsut.teamId.organizer.v1',
];

const IS_WEB = Platform.OS === 'web';
const REQUEST_TIMEOUT_MS = 20_000;

export type TeamSession = {
  teamId: string;
  teamName: string;
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

/** The error thrown when a team request is attempted with no usable session. */
export type NoTeamSessionError = AppError & { code: 'no_team_session' };

export function isNoTeamSessionError(err: unknown): err is NoTeamSessionError {
  return (
    isAppError(err) && (err as { code?: unknown }).code === 'no_team_session'
  );
}

// In-memory copy in front of storage. `loaded` avoids re-reading storage on
// every request.
let memorySession: TeamSession | null = null;
let loaded = false;
// Bumped on every save/clear so a slow initial read can tell that the session
// changed while it was in flight and must not overwrite it.
let sessionVersion = 0;
let loadPromise: Promise<void> | null = null;

// Storage writes and deletes run strictly in call order, so a late delete of
// an expired entry can never land after a newer save.
let storageQueue: Promise<void> = Promise.resolve();
function enqueueStorage(op: () => Promise<void>): Promise<void> {
  const next = storageQueue.then(op, op);
  storageQueue = next.catch(() => {});
  return next;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyChanged(): void {
  // A throwing listener must not abort a save before its storage write is
  // queued, or stop the other listeners.
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

/** Register a callback fired whenever the team session is saved or cleared. */
export function subscribeTeamSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isExpired(session: TeamSession): boolean {
  return !(session.expiresAt > Date.now());
}

function parseStored(raw: string | null): TeamSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const { teamId, teamName, token, expiresAt } = v as Record<string, unknown>;
    if (typeof teamId !== 'string' || !teamId.trim()) return null;
    if (typeof teamName !== 'string') return null;
    if (typeof token !== 'string' || !token.trim()) return null;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
      return null;
    }
    return { teamId, teamName, token, expiresAt };
  } catch {
    return null;
  }
}

async function readStored(): Promise<string | null> {
  return IS_WEB
    ? await AsyncStorage.getItem(SESSION_KEY)
    : await SecureStore.getItemAsync(SESSION_KEY);
}

function deleteStored(): Promise<void> {
  return enqueueStorage(async () => {
    try {
      if (IS_WEB) await AsyncStorage.removeItem(SESSION_KEY);
      else await SecureStore.deleteItemAsync(SESSION_KEY);
    } catch {
      // Best-effort; the in-memory copy is already cleared.
    }
  });
}

async function removeLegacyTeamIds(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(LEGACY_TEAM_ID_KEYS);
  } catch {
    // ignore
  }
}

async function loadFromStorage(): Promise<void> {
  const versionAtStart = sessionVersion;
  let stored: TeamSession | null = null;
  try {
    stored = parseStored(await readStored());
  } catch {
    stored = null;
  }
  // A session saved or cleared while the read was in flight is newer than
  // whatever the read returned; keep it.
  if (sessionVersion === versionAtStart) {
    memorySession = stored;
  }
  loaded = true;
  if (sessionVersion === versionAtStart && stored) notifyChanged();
  void removeLegacyTeamIds();
}

/**
 * Current non-expired session, or null. An expired entry is treated as absent
 * and deleted.
 */
export async function getTeamSession(): Promise<TeamSession | null> {
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
    notifyChanged();
  }
  return memorySession;
}

async function saveTeamSession(session: TeamSession): Promise<void> {
  memorySession = session;
  loaded = true;
  sessionVersion += 1;
  notifyChanged();
  const raw = JSON.stringify(session);
  try {
    await enqueueStorage(() =>
      IS_WEB
        ? AsyncStorage.setItem(SESSION_KEY, raw)
        : SecureStore.setItemAsync(SESSION_KEY, raw, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
    );
  } catch {
    // The session still works for this run; it just will not survive a restart.
  }
}

async function clearTeamSession(): Promise<void> {
  memorySession = null;
  loaded = true;
  sessionVersion += 1;
  notifyChanged();
  await deleteStored();
}

/** Forget the team session on this device. */
export async function leaveTeam(): Promise<void> {
  await clearTeamSession();
}

/**
 * Subscribe a component to the team session. `isLoading` is true until the
 * stored session has been read once. The session re-reads (and drops an
 * expired one) on every change notification.
 */
export function useTeamSession(): {
  session: TeamSession | null;
  isLoading: boolean;
} {
  const [state, setState] = useState<{
    session: TeamSession | null;
    isLoading: boolean;
  }>(() => ({
    // An expired session is not rendered for a frame; the effect below
    // re-reads it through `getTeamSession()`, which also deletes it.
    session:
      loaded && memorySession && !isExpired(memorySession)
        ? memorySession
        : null,
    isLoading: !loaded,
  }));

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getTeamSession().then((session) => {
        if (active) setState({ session, isLoading: false });
      });
    };
    refresh();
    const unsubscribe = subscribeTeamSession(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}

export function teamHeaders(token: string): Record<string, string> {
  return { 'X-Team-Token': token.trim() };
}

function noSessionError(): NoTeamSessionError {
  return {
    kind: 'unknown',
    status: 401,
    code: 'no_team_session',
    message: 'Join a team to continue.',
  };
}

/**
 * Call when a team request got a 401. Drops the stored session. `usedToken` is
 * the token the failed request carried; if the session has since been replaced
 * (the team rejoined), the late 401 is ignored. Returns whether it was dropped.
 */
async function handleTeamUnauthorized(usedToken: string): Promise<boolean> {
  if (memorySession && memorySession.token !== usedToken) return false;
  await clearTeamSession();
  return true;
}

/**
 * Run a team request with the stored token. Throws a `NoTeamSessionError`
 * before any network call when there is no session (or it expired). A 401 from
 * the server clears the session and rethrows the error.
 */
export async function withTeamToken<T>(
  run: (token: string) => Promise<T>,
): Promise<T> {
  const session = await getTeamSession();
  if (!session) throw noSessionError();
  try {
    return await run(session.token);
  } catch (err) {
    if (isAppError(err) && err.status === 401) {
      await handleTeamUnauthorized(session.token);
    }
    throw err;
  }
}

/**
 * Call a team route with the stored session token (`X-Team-Token`). Nothing is
 * sent when there is no session, and a 401 clears the session.
 */
export async function teamJson<T>(
  path: string,
  init: HttpJsonInit = {},
): Promise<T> {
  return await withTeamToken((token) =>
    httpJson<T>(apiUrl(path), {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...teamHeaders(token),
      },
    }),
  );
}

function joinError(err: unknown): AppError {
  const status = isAppError(err) ? err.status : undefined;
  if (status === 404) {
    return { kind: 'unknown', status, message: 'No team with that code.' };
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
    message: "Couldn't join the team. Try again in a moment.",
  };
}

type JoinResponse = {
  team?: { id?: unknown; name?: unknown };
  token?: unknown;
  expires_at?: unknown;
};

/**
 * Exchange an invite code (trimmed and upper-cased) for a team session, save
 * it and return it. Throws an AppError with a user-facing message: status 404
 * for an unknown code, kind
 * `network` when the server cannot be reached. An existing session is left
 * alone until the join succeeds, then replaced.
 */
export async function joinTeam(inviteCode: string): Promise<TeamSession> {
  const code = (inviteCode ?? '').trim().toUpperCase();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let res: JoinResponse;
  try {
    res = await httpJson<JoinResponse>(apiUrl('/teams/join'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite_code: code }),
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw joinError({ kind: 'network', cause: err } satisfies AppError);
    }
    throw joinError(err);
  } finally {
    clearTimeout(timer);
  }

  const rawId = res.team?.id;
  const teamId =
    typeof rawId === 'string'
      ? rawId.trim()
      : typeof rawId === 'number'
        ? String(rawId)
        : '';
  const teamName = typeof res.team?.name === 'string' ? res.team.name : '';
  const expiresAt =
    typeof res.expires_at === 'string' ? Date.parse(res.expires_at) : NaN;
  if (
    !teamId ||
    typeof res.token !== 'string' ||
    !res.token ||
    !Number.isFinite(expiresAt)
  ) {
    throw joinError(undefined);
  }

  const session: TeamSession = {
    teamId,
    teamName,
    token: res.token,
    expiresAt,
  };
  await saveTeamSession(session);
  return session;
}
