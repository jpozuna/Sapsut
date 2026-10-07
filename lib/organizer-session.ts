import AsyncStorage from '@react-native-async-storage/async-storage';

const ORGANIZER_CODE_KEY = 'sapsut.organizerCode.v1';

/**
 * The organizer code doubles as the session: a stored code means the last
 * session was signed in as an organizer. It is the same shared code the
 * backend checks on every organizer request, so this only restores the client
 * role — the server still authorizes each call.
 */
export async function getSavedOrganizerCode(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(ORGANIZER_CODE_KEY);
    const trimmed = (v ?? '').trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function saveOrganizerCode(code: string): Promise<void> {
  const trimmed = (code ?? '').trim();
  if (!trimmed) return;
  try {
    await AsyncStorage.setItem(ORGANIZER_CODE_KEY, trimmed);
  } catch {
    // Best-effort persistence; ignore.
  }
}

export async function clearOrganizerCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ORGANIZER_CODE_KEY);
  } catch {
    // ignore
  }
}
