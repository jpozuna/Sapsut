import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import type { AppError } from '@/lib/app-error';
import { textStyles, useAppTheme } from '@/lib/ui';

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
        message:
          'Looks like you’re offline. Check your connection and try again.',
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
  const { textColor, backgroundColor, tint } = useAppTheme();

  const copy = getDefaultCopy(error);
  const title = titleOverride ?? copy.title;
  const message = error.message?.trim() ? error.message : copy.message;

  const canGoBack = router.canGoBack();
  const handleGoBack =
    onGoBack ?? (canGoBack ? () => router.back() : undefined);
  const primaryAction =
    onRetry ?? handleGoBack ?? (() => router.replace('/(tabs)'));

  const primaryLabel = onRetry ? 'Retry' : handleGoBack ? 'Go back' : 'Go home';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.content}>
        <Text style={[textStyles.title, styles.title, { color: textColor }]}>
          {title}
        </Text>
        <Text style={[textStyles.default, styles.message, { color: textColor }]}>
          {message}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={primaryAction}
            style={[styles.primaryButton, { borderColor: tint }]}
          >
            <Text style={[textStyles.defaultSemiBold, styles.primaryText, { color: tint }]}>
              {primaryLabel}
            </Text>
          </TouchableOpacity>

          {onRetry && handleGoBack ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleGoBack}
              style={styles.secondaryButton}
            >
              <Text style={[textStyles.default, styles.secondaryText, { color: textColor }]}>
                Go back
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
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
