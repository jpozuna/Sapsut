import { Redirect } from 'expo-router';

export default function Index() {
  // Keep `/` from showing the starter screen; send users to the app.
  return <Redirect href="/(tabs)" />;
}
