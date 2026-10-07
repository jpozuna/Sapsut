import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { HitSlop, Radius, Spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';
import { AppText } from './app-text';
import { IconSymbol } from './icon-symbol';

type NavBarProps = {
  title?: string;
  onBack?: () => void;
  /** Right-aligned action slot. */
  rightSlot?: ReactNode;
};

/** Back row for pushed (non-tab) screens. */
export function NavBar({ title, onBack, rightSlot }: NavBarProps) {
  const { colors } = useAppTheme();

  const handleBack =
    onBack ??
    (() => {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    });

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handleBack}
        hitSlop={HitSlop}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={[styles.backButton, { backgroundColor: colors.surfaceSunken }]}
      >
        <IconSymbol name="arrow.left" size={18} color={colors.textPrimary} />
      </Pressable>

      {title ? (
        <AppText variant="title" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
      ) : (
        <View style={styles.title} />
      )}

      {rightSlot ?? <View style={styles.spacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingBottom: Spacing.base,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  spacer: {
    width: 36,
  },
});
