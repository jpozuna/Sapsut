import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import {
  clearOrganizerCode,
  getSavedOrganizerCode,
  saveOrganizerCode,
} from '@/lib/organizer-session';

export type AppRole = 'participant' | 'organizer';

type RoleContextValue = {
  role: AppRole;
  organizerCode: string;
  /**
   * True until the stored organizer session has been read back. Route guards
   * must wait for this, otherwise a reload redirects an organizer away before
   * their role is restored.
   */
  isHydrating: boolean;
  setRole: (role: AppRole) => void;
  setOrganizerCode: (code: string) => void;
  enterOrganizerMode: (code: string) => void;
  exitOrganizerMode: () => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider(props: { children: ReactNode }) {
  const [role, setRole] = useState<AppRole>('participant');
  const [organizerCode, setOrganizerCode] = useState('');
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = await getSavedOrganizerCode();
      if (!mounted) return;
      if (saved) {
        setOrganizerCode(saved);
        setRole('organizer');
      }
      setIsHydrating(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    // Persisting here rather than inside the setters covers every path that
    // can change the role, including `setRole` from the review screen.
    if (isHydrating) return;
    if (role === 'organizer' && organizerCode.trim()) {
      void saveOrganizerCode(organizerCode);
    } else {
      void clearOrganizerCode();
    }
  }, [isHydrating, organizerCode, role]);

  const value = useMemo<RoleContextValue>(() => {
    return {
      role,
      organizerCode,
      isHydrating,
      setRole: (r) => setRole(r),
      setOrganizerCode: (code) => setOrganizerCode(code),
      enterOrganizerMode: (code) => {
        const c = code.trim();
        setOrganizerCode(c);
        setRole('organizer');
      },
      exitOrganizerMode: () => {
        setOrganizerCode('');
        setRole('participant');
      },
    };
  }, [isHydrating, organizerCode, role]);

  return (
    <RoleContext.Provider value={value}>{props.children}</RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
