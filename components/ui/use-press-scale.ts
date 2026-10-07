import { useCallback } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

const SPRING = { damping: 18, stiffness: 320, mass: 0.5 };

/** Shared tactile press feedback: a subtle inward scale on press-in. */
export function usePressScale(scale: number = Motion.pressScale) {
  const progress = useSharedValue(1);

  const onPressIn = useCallback(() => {
    progress.value = withSpring(scale, SPRING);
  }, [progress, scale]);

  const onPressOut = useCallback(() => {
    progress.value = withSpring(1, SPRING);
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value }],
  }));

  return { animatedStyle, onPressIn, onPressOut };
}
