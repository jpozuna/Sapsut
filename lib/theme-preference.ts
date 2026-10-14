import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, Platform } from 'react-native';

import type { ColorScheme } from '@/constants/theme';

/**
 * User's light/dark override. `null` follows the system setting. Persisted in
 * AsyncStorage so the choice survives reloads; read by `useColorScheme`.
 */

const PREFERENCE_KEY = 'sapsut.colorScheme.v1';

let preference: ColorScheme | null = null;
const listeners = new Set<() => void>();

function apply(next: ColorScheme | null) {
  preference = next;
  // Keep native chrome (alerts, keyboards, pickers) in step with the app.
  if (Platform.OS !== 'web') Appearance.setColorScheme(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getPreference() {
  return preference;
}

export function useColorSchemePreference(): ColorScheme | null {
  return useSyncExternalStore(subscribe, getPreference, getPreference);
}

export function setColorSchemePreference(next: ColorScheme | null) {
  apply(next);
  const write = next
    ? AsyncStorage.setItem(PREFERENCE_KEY, next)
    : AsyncStorage.removeItem(PREFERENCE_KEY);
  write.catch(() => {
    // Not fatal: the choice still applies for this session.
  });
}

/** Restore the saved choice. Called once from the root layout. */
export async function loadColorSchemePreference() {
  try {
    const saved = await AsyncStorage.getItem(PREFERENCE_KEY);
    if (saved === 'light' || saved === 'dark') apply(saved);
  } catch {
    // Storage unavailable; follow the system setting.
  }
}
