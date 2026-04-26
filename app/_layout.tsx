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

  return (
    <AppErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RoleProvider>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
        </RoleProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
