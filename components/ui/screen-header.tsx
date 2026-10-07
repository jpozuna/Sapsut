import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { AppText } from './app-text';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  /** Rendered above the title — typically the logo or an eyebrow label. */
  topSlot?: ReactNode;
  /** Rendered on the title row, right-aligned — typically a stat or action. */
  rightSlot?: ReactNode;
};

export function ScreenHeader({
  title,
  subtitle,
  topSlot,
  rightSlot,
}: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      {topSlot ? <View style={styles.topSlot}>{topSlot}</View> : null}
      <View style={styles.titleRow}>
        <AppText variant="display" style={styles.title}>
          {title}
        </AppText>
        {rightSlot}
      </View>
      {subtitle ? (
        <AppText variant="callout" tone="secondary">
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
    paddingBottom: Spacing.base,
  },
  topSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  title: {
    flexShrink: 1,
  },
});
