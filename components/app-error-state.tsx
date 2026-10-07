import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppButton, AppText, IconSymbol } from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Radius, Spacing } from '@/constants/theme';
import type { AppError } from '@/lib/app-error';
import { useAppTheme } from '@/lib/ui';

export type AppErrorStateProps = {
  error: AppError;
  onRetry?: () => void;
  onGoBack?: () => void;
  titleOverride?: string;
};

function getDefaultCopy(error: AppError): {
  title: string;
  message: string;
  icon: IconSymbolName;
} {
  switch (error.kind) {
    case 'network':
      return {
        title: 'No connection',
        message:
          'Looks like you’re offline. Check your connection and try again.',
        icon: 'wifi.slash',
      };
    case 'server':
      return {
        title: 'Server error',
        message: 'Our servers are having a moment. Please try again.',
        icon: 'exclamationmark.triangle.fill',
      };
    default:
      return {
        title: 'Something went wrong',
        message: 'Try again, or head back and try a different path.',
        icon: 'exclamationmark.triangle.fill',
      };
  }
}

export function AppErrorState({
  error,
  onRetry,
  onGoBack,
  titleOverride,
}: AppErrorStateProps) {
  const { colors } = useAppTheme();

  const copy = getDefaultCopy(error);
  const title = titleOverride ?? copy.title;
  const message = error.message?.trim() ? error.message : copy.message;

  const canGoBack = router.canGoBack();
  const handleGoBack =
    onGoBack ?? (canGoBack ? () => router.back() : undefined);
  const primaryAction =
    onRetry ?? handleGoBack ?? (() => router.replace('/(tabs)'));
  const primaryLabel = onRetry
    ? 'Try again'
    : handleGoBack
      ? 'Go back'
      : 'Go home';

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: colors.dangerSoft }]}>
          <IconSymbol name={copy.icon} size={28} color={colors.danger} />
        </View>

        <View style={styles.copy}>
          <AppText variant="heading" align="center">
            {title}
          </AppText>
          <AppText variant="body" tone="secondary" align="center">
            {message}
          </AppText>
        </View>

        <View style={styles.actions}>
          <AppButton tone="primary" fullWidth onPress={primaryAction}>
            {primaryLabel}
          </AppButton>
          {onRetry && handleGoBack ? (
            <AppButton tone="ghost" fullWidth onPress={handleGoBack}>
              Go back
            </AppButton>
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
    padding: Spacing.xl,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    gap: Spacing.sm,
    alignItems: 'center',
  },
  actions: {
    width: '100%',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});
