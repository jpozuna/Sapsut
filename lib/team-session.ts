import AsyncStorage from '@react-native-async-storage/async-storage';

export type TeamIdScope = 'participant' | 'organizer';

function keyForScope(scope: TeamIdScope): string {
  return scope === 'organizer'
    ? 'sapsut.teamId.organizer.v1'
    : 'sapsut.teamId.participant.v1';
}

export async function getSavedTeamId(
  scope: TeamIdScope = 'participant',
): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(keyForScope(scope));
    const trimmed = (v ?? '').trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function saveTeamId(
  teamId: string,
  scope: TeamIdScope = 'participant',
): Promise<void> {
  const trimmed = (teamId ?? '').trim();
  if (!trimmed) return;
  try {
    await AsyncStorage.setItem(keyForScope(scope), trimmed);
  } catch {
    // Best-effort persistence; ignore.
  }
}

export async function clearSavedTeamId(
  scope: TeamIdScope = 'participant',
): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyForScope(scope));
  } catch {
    // ignore
  }
}
