import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useFonts } from 'expo-font';
import {
  JosefinSans_400Regular,
  JosefinSans_600SemiBold,
} from '@expo-google-fonts/josefin-sans';
import {
  JosefinSlab_400Regular,
  JosefinSlab_600SemiBold,
} from '@expo-google-fonts/josefin-slab';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AppLoading } from '@/components/app-loading';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    JosefinSans_400Regular,
    JosefinSans_600SemiBold,
    JosefinSlab_400Regular,
    JosefinSlab_600SemiBold,
  });

  if (!fontsLoaded) {
    return <AppLoading label="Getting things ready…" />;
  }

  return (
    <AppErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="modal"
            options={{ presentation: 'modal', title: 'Modal' }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
