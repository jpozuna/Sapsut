import { Redirect, Stack } from 'expo-router';

import { useRole } from '@/lib/role-context';

export default function OrganizerLayout() {
  const { role, isHydrating } = useRole();

  // Wait for the stored session, otherwise a reload redirects an organizer
  // away before their role has been restored.
  if (isHydrating) return null;

  // Hiding the tab is only cosmetic — deep links and direct navigation still
  // resolve these routes, so the role is enforced here as well.
  if (role !== 'organizer') return <Redirect href="/(tabs)" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-task" />
      <Stack.Screen name="review" />
      <Stack.Screen name="history" />
    </Stack>
  );
}
