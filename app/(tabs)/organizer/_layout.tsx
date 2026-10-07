import { Redirect, Stack } from 'expo-router';

import { useRole } from '@/lib/role-context';

export default function OrganizerTabLayout() {
  const { role, isHydrating } = useRole();

  // Wait for the stored session, otherwise a reload redirects an organizer
  // away before their role has been restored.
  if (isHydrating) return null;

  // The tab is hidden for participants, but the route is still reachable by
  // deep link or direct navigation, so the role is enforced here as well.
  if (role !== 'organizer') return <Redirect href="/(tabs)" />;

  // Keep bottom tabs visible; suppress native headers.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-task" />
      <Stack.Screen name="review" />
      <Stack.Screen name="history" />
    </Stack>
  );
}
