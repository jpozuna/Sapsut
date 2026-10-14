import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { IconSymbol } from '@/components/ui';
import { elevation, HitSlop, Motion, Radius } from '@/constants/theme';
import { setColorSchemePreference } from '@/lib/theme-preference';
import { useAppTheme } from '@/lib/ui';

const TRACK = { width: 56, height: 32 };
const PADDING = 3;
const THUMB = TRACK.height - PADDING * 2;
const TRAVEL = TRACK.width - THUMB - PADDING * 2;

/**
 * Light/dark switch. The thumb slides right for dark mode and shows a moon;
 * left for light mode with a sun.
 */
export function ThemeToggle() {
  const { colors, isDark } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const position = useSharedValue(isDark ? 1 : 0);

  useEffect(() => {
    const target = isDark ? 1 : 0;
    position.value = reduceMotion
      ? target
      : withTiming(target, { duration: Motion.base });
  }, [isDark, position, reduceMotion]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      position.value,
      [0, 1],
      [colors.surfaceSunken, colors.accentSoft],
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * TRAVEL }],
  }));

  return (
    <Pressable
      onPress={() => setColorSchemePreference(isDark ? 'light' : 'dark')}
      hitSlop={HitSlop}
      accessibilityRole="switch"
      accessibilityLabel="Dark mode"
      accessibilityState={{ checked: isDark }}
    >
      <Animated.View
        style={[styles.track, { borderColor: colors.border }, trackStyle]}
      >
        <Animated.View
          style={[
            styles.thumb,
            elevation(1, colors.shadow),
            { backgroundColor: colors.surface },
            thumbStyle,
          ]}
        >
          <IconSymbol
            name={isDark ? 'moon.fill' : 'sun.max.fill'}
            size={16}
            color={isDark ? colors.accentOnSoft : colors.textSecondary}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK.width,
    height: TRACK.height,
    padding: PADDING,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
});
