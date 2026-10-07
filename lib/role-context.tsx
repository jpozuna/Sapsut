import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  clearOrganizerSession,
  getOrganizerSession,
  handleOrganizerUnauthorized,
  onOrganizerUnauthorized,
  removeLegacyOrganizerCode,
  signInWithOrganizerCode,
  verifyOrganizerSession,
} from '@/lib/organizer-session';

export type AppRole = 'participant' | 'organizer';

// Organizer screens still prefill a text field from `organizerCode` and gate
// their requests on it being non-empty. The real code is never kept, so while
// a session exists this is a fixed, non-secret marker; the request helpers
// ignore it and send the stored token instead.
const SESSION_MARKER = 'session';

type RoleContextValue = {
  role: AppRole;
  /**
   * @deprecated The organizer code is never stored. This is a non-secret
   * marker ('session') while signed in as organizer, '' otherwise. Organizer
   * requests authenticate with the stored session token.
   */
  organizerCode: string;
  /**
   * True until the stored organizer session has been restored and verified
   * with the server. Route guards must wait for this, otherwise a reload
   * redirects an organizer away before their role is restored.
   */
  isHydrating: boolean;
  /** Only `participant` has an effect; organizer needs a verified sign-in. */
  setRole: (role: AppRole) => void;
  /** @deprecated No-op: the organizer code is no longer kept client-side. */
  setOrganizerCode: (code: string) => void;
  /**
   * Exchange the code for a session token and switch to organizer. Rejects
   * with an AppError whose `message` is safe to show to the user.
   */
  enterOrganizerMode: (code: string) => Promise<void>;
  exitOrganizerMode: () => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider(props: { children: ReactNode }) {
  const [role, setRoleState] = useState<AppRole>('participant');
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await removeLegacyOrganizerCode();
      const session = await getOrganizerSession();
      if (session) {
        const check = await verifyOrganizerSession(session.token);
        if (!mounted) return;
        if (check === 'invalid') {
          // Only drops the session if it is still the token that was
          // verified; a sign-in that finished meanwhile is left alone.
          await handleOrganizerUnauthorized(session.token);
        } else {
          // Valid, or the server could not be reached: keep the organizer
          // role, since the server still authorizes every call. Skip it if
          // the session changed during the check (signed in again, or out).
          const current = await getOrganizerSession();
          if (!mounted) return;
          if (current?.token === session.token) setRoleState('organizer');
        }
      }
      if (!mounted) return;
      setIsHydrating(false);
    })().catch(() => {
      if (mounted) setIsHydrating(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    // Any organizer request that gets a 401 has already dropped the token.
    return onOrganizerUnauthorized(() => setRoleState('participant'));
  }, []);

  const exitOrganizerMode = useCallback(() => {
    setRoleState('participant');
    void clearOrganizerSession();
  }, []);

  const enterOrganizerMode = useCallback(async (code: string) => {
    await signInWithOrganizerCode(code);
    setRoleState('organizer');
  }, []);

  const value = useMemo<RoleContextValue>(() => {
    return {
      role,
      organizerCode: role === 'organizer' ? SESSION_MARKER : '',
      isHydrating,
      setRole: (r) => {
        if (r === 'participant') exitOrganizerMode();
      },
      setOrganizerCode: () => {},
      enterOrganizerMode,
      exitOrganizerMode,
    };
  }, [enterOrganizerMode, exitOrganizerMode, isHydrating, role]);

  return (
    <RoleContext.Provider value={value}>{props.children}</RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
