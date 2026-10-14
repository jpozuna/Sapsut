import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useColorSchemePreference } from '@/lib/theme-preference';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const preference = useColorSchemePreference();
  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return preference ?? colorScheme;
  }

  return 'light';
}
