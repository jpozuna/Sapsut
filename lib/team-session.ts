import AsyncStorage from '@react-native-async-storage/async-storage';

const TEAM_ID_KEY = 'sapsut.teamId.v1';

export async function getSavedTeamId(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(TEAM_ID_KEY);
    const trimmed = (v ?? '').trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function saveTeamId(teamId: string): Promise<void> {
  const trimmed = (teamId ?? '').trim();
  if (!trimmed) return;
  try {
    await AsyncStorage.setItem(TEAM_ID_KEY, trimmed);
  } catch {
    // Best-effort persistence; ignore.
  }
}

export async function clearSavedTeamId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TEAM_ID_KEY);
  } catch {
    // ignore
  }
}
