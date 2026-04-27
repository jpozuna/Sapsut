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
import { View } from 'react-native';
import {
  MD3DarkTheme,
  MD3LightTheme,
  PaperProvider,
  configureFonts,
} from 'react-native-paper';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { RoleProvider } from '@/lib/role-context';

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
    // Avoid ThemedText / custom fonts before they're loaded.
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.light.background,
        }}
      />
    );
  }

  const paperTheme =
    colorScheme === 'dark'
      ? {
          ...MD3DarkTheme,
          colors: {
            ...MD3DarkTheme.colors,
            primary: Colors.dark.tint,
            onPrimary: Colors.dark.background,
            background: Colors.dark.background,
            surface: Colors.dark.background,
            onSurface: Colors.dark.text,
            onBackground: Colors.dark.text,
            outline: Colors.dark.icon,
          },
          fonts: configureFonts({
            config: {
              displayLarge: { fontFamily: 'JosefinSlab_600SemiBold' },
              displayMedium: { fontFamily: 'JosefinSlab_600SemiBold' },
              displaySmall: { fontFamily: 'JosefinSlab_600SemiBold' },
              headlineLarge: { fontFamily: 'JosefinSlab_600SemiBold' },
              headlineMedium: { fontFamily: 'JosefinSlab_600SemiBold' },
              headlineSmall: { fontFamily: 'JosefinSlab_600SemiBold' },
              titleLarge: { fontFamily: 'JosefinSans_600SemiBold' },
              titleMedium: { fontFamily: 'JosefinSans_600SemiBold' },
              titleSmall: { fontFamily: 'JosefinSans_600SemiBold' },
              labelLarge: { fontFamily: 'JosefinSans_600SemiBold' },
              labelMedium: { fontFamily: 'JosefinSans_600SemiBold' },
              labelSmall: { fontFamily: 'JosefinSans_600SemiBold' },
              bodyLarge: { fontFamily: 'JosefinSans_400Regular' },
              bodyMedium: { fontFamily: 'JosefinSans_400Regular' },
              bodySmall: { fontFamily: 'JosefinSans_400Regular' },
            },
          }),
        }
      : {
          ...MD3LightTheme,
          colors: {
            ...MD3LightTheme.colors,
            primary: Colors.light.tint,
            onPrimary: Colors.light.background,
            background: Colors.light.background,
            surface: Colors.light.background,
            onSurface: Colors.light.text,
            onBackground: Colors.light.text,
            outline: Colors.light.icon,
          },
          fonts: configureFonts({
            config: {
              displayLarge: { fontFamily: 'JosefinSlab_600SemiBold' },
              displayMedium: { fontFamily: 'JosefinSlab_600SemiBold' },
              displaySmall: { fontFamily: 'JosefinSlab_600SemiBold' },
              headlineLarge: { fontFamily: 'JosefinSlab_600SemiBold' },
              headlineMedium: { fontFamily: 'JosefinSlab_600SemiBold' },
              headlineSmall: { fontFamily: 'JosefinSlab_600SemiBold' },
              titleLarge: { fontFamily: 'JosefinSans_600SemiBold' },
              titleMedium: { fontFamily: 'JosefinSans_600SemiBold' },
              titleSmall: { fontFamily: 'JosefinSans_600SemiBold' },
              labelLarge: { fontFamily: 'JosefinSans_600SemiBold' },
              labelMedium: { fontFamily: 'JosefinSans_600SemiBold' },
              labelSmall: { fontFamily: 'JosefinSans_600SemiBold' },
              bodyLarge: { fontFamily: 'JosefinSans_400Regular' },
              bodyMedium: { fontFamily: 'JosefinSans_400Regular' },
              bodySmall: { fontFamily: 'JosefinSans_400Regular' },
            },
          }),
        };

  return (
    <AppErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <PaperProvider theme={paperTheme}>
          <RoleProvider>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
            <StatusBar style="auto" />
          </RoleProvider>
        </PaperProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
