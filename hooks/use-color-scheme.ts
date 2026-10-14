import { useColorScheme as useRNColorScheme } from 'react-native';

import { useColorSchemePreference } from '@/lib/theme-preference';

/** The user's light/dark choice, falling back to the system setting. */
export function useColorScheme() {
  const preference = useColorSchemePreference();
  const system = useRNColorScheme();
  return preference ?? system;
}
