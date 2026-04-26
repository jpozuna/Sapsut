import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type AppLoadingProps = {
  label?: string;
  fullScreen?: boolean;
};

export function AppLoading({ label = 'Loading…', fullScreen = true }: AppLoadingProps) {
  const colorScheme = useColorScheme();
  const spinnerColor = Colors[colorScheme ?? 'light'].tint;

  const content = (
    <View style={styles.content}>
      <ActivityIndicator size="large" color={spinnerColor} />
      {label ? <ThemedText style={styles.label}>{label}</ThemedText> : null}
    </View>
  );

  if (!fullScreen) return content;

  return <ThemedView style={styles.fullScreen}>{content}</ThemedView>;
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    gap: 12,
  },
  label: {
    textAlign: 'center',
    opacity: 0.9,
  },
});

