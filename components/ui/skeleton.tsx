import { useEffect } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';

type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Placeholder block with a gentle pulse — replaces blocking spinners. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = Radius.xs,
  style,
}: SkeletonProps) {
  const { colors } = useAppTheme();
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.skeleton,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Card-shaped placeholder matching the task/leaderboard row rhythm. */
export function SkeletonCard() {
  const { colors, elevation } = useAppTheme();

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface }, elevation(1)]}
    >
      <View style={styles.row}>
        <Skeleton width="55%" height={18} />
        <Skeleton width={56} height={22} radius={Radius.pill} />
      </View>
      <Skeleton width="90%" height={13} />
      <Skeleton width="70%" height={13} />
      <Skeleton width={78} height={22} radius={Radius.pill} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
