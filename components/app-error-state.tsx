import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import type { AppError } from '@/lib/app-error';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type AppErrorStateProps = {
  error: AppError;
  onRetry?: () => void;
  onGoBack?: () => void;
  titleOverride?: string;
};

function getDefaultCopy(error: AppError): { title: string; message: string } {
  switch (error.kind) {
    case 'network':
      return {
        title: 'No connection',
        message: 'Looks like you’re offline. Check your connection and try again.',
      };
    case 'server':
      return {
        title: 'Server error',
        message: 'Our servers are having a moment. Please try again.',
      };
    default:
      return {
        title: 'Something went wrong',
        message: 'Try again, or head back and try a different path.',
      };
  }
}

export function AppErrorState({
  error,
  onRetry,
  onGoBack,
  titleOverride,
}: AppErrorStateProps) {
  const theme = useColorScheme() ?? 'light';
  const tint = Colors[theme].tint;

  const copy = getDefaultCopy(error);
  const title = titleOverride ?? copy.title;
  const message = error.message?.trim() ? error.message : copy.message;

  const canGoBack = router.canGoBack();
  const handleGoBack = onGoBack ?? (canGoBack ? () => router.back() : undefined);
  const primaryAction =
    onRetry ?? handleGoBack ?? (() => router.replace('/(tabs)'));

  const primaryLabel = onRetry ? 'Retry' : handleGoBack ? 'Go back' : 'Go home';

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <ThemedText type="title" style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText style={styles.message}>{message}</ThemedText>

        <View style={styles.actions}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={primaryAction}
            style={[styles.primaryButton, { borderColor: tint }]}
          >
            <ThemedText
              type="defaultSemiBold"
              style={[styles.primaryText, { color: tint }]}
            >
              {primaryLabel}
            </ThemedText>
          </TouchableOpacity>

          {onRetry && handleGoBack ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleGoBack}
              style={styles.secondaryButton}
            >
              <ThemedText style={styles.secondaryText}>Go back</ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 520,
    gap: 12,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    opacity: 0.9,
  },
  actions: {
    marginTop: 8,
    gap: 10,
    width: '100%',
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  primaryText: {
    fontSize: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  secondaryText: {
    opacity: 0.85,
  },
});

