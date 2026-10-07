import { StyleSheet, View } from 'react-native';

import { SafeScreen } from '@/components/safe-screen';
import { Skeleton, SkeletonCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';

export type AppLoadingProps = {
  /** Number of placeholder cards to render. */
  rows?: number;
  fullScreen?: boolean;
};

/**
 * Skeleton-based loading state. Showing the shape of the incoming content reads
 * as faster than a centered spinner.
 */
export function AppLoading({ rows = 4, fullScreen = true }: AppLoadingProps) {
  const { colors } = useAppTheme();

  const content = (
    <View style={styles.content}>
      <View style={styles.header}>
        <Skeleton width={132} height={30} />
        <Skeleton width={190} height={14} />
      </View>
      <View style={styles.list}>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </View>
    </View>
  );

  if (!fullScreen) return content;

  return <SafeScreen backgroundColor={colors.canvas}>{content}</SafeScreen>;
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: Spacing.xl,
  },
  header: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  list: {
    gap: Spacing.md,
  },
});
