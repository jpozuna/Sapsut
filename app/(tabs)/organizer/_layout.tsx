import { Stack } from 'expo-router';

export default function OrganizerTabLayout() {
  // Keep bottom tabs visible; suppress native headers.
  return <Stack screenOptions={{ headerShown: false }} />;
}
