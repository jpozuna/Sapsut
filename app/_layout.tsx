import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme,
} from '@react-navigation/native';
import {
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { Palette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { RoleProvider } from '@/lib/role-context';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash may already be hidden during fast refresh; not fatal.
});

function navigationTheme(scheme: 'light' | 'dark'): Theme {
  const palette = Palette[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.accent,
      background: palette.canvas,
      card: palette.surface,
      text: palette.textPrimary,
      border: palette.border,
      notification: palette.brick,
    },
  };
}

export default function RootLayout() {
  const colorScheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const palette = Palette[colorScheme];

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });

  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: palette.canvas }} />;
  }

  return (
    <AppErrorBoundary>
      <ThemeProvider value={navigationTheme(colorScheme)}>
        <RoleProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.canvas },
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        </RoleProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
