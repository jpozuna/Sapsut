import { createContext, useContext, useMemo, useState } from 'react';

export type AppRole = 'participant' | 'organizer';

type RoleContextValue = {
  role: AppRole;
  organizerCode: string;
  setRole: (role: AppRole) => void;
  setOrganizerCode: (code: string) => void;
  enterOrganizerMode: (code: string) => void;
  exitOrganizerMode: () => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider(props: { children: React.ReactNode }) {
  const [role, setRole] = useState<AppRole>('participant');
  const [organizerCode, setOrganizerCode] = useState('');

  const value = useMemo<RoleContextValue>(() => {
    return {
      role,
      organizerCode,
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
  }, [organizerCode, role]);

  return <RoleContext.Provider value={value}>{props.children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}

