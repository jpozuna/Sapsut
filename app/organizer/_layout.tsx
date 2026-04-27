import { Stack } from 'expo-router';

export default function OrganizerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-task" />
      <Stack.Screen name="review" />
      <Stack.Screen name="history" />
    </Stack>
  );
}
