import { StyleSheet, View } from 'react-native';

import { AppButton, AppText, IconSymbol } from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Radius, Spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';

type EmptyStateProps = {
  icon?: IconSymbolName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({
  icon = 'tray.fill',
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
        <IconSymbol name={icon} size={26} color={colors.accent} />
      </View>
      <View style={styles.copy}>
        <AppText variant="heading" align="center">
          {title}
        </AppText>
        {message ? (
          <AppText variant="callout" tone="secondary" align="center">
            {message}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <AppButton tone="secondary" size="sm" onPress={onAction}>
          {actionLabel}
        </AppButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.base,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    gap: Spacing.xs,
    alignItems: 'center',
  },
});
