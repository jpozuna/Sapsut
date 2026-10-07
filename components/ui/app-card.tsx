import { PropsWithChildren } from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';
import { usePressScale } from './use-press-scale';

export type AppCardVariant = 'elevated' | 'outlined' | 'sunken';

type AppCardProps = PropsWithChildren<{
  variant?: AppCardVariant;
  onPress?: () => void;
  disabled?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}>;

export function AppCard({
  children,
  variant = 'elevated',
  onPress,
  disabled = false,
  padded = true,
  style,
}: AppCardProps) {
  const { colors, elevation } = useAppTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(0.985);

  const variantStyle = {
    elevated: {
      backgroundColor: colors.surface,
      borderWidth: 0,
      borderColor: 'transparent',
      ...elevation(1),
    },
    outlined: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      ...elevation(0),
    },
    sunken: {
      backgroundColor: colors.surfaceSunken,
      borderWidth: 0,
      borderColor: 'transparent',
      ...elevation(0),
    },
  }[variant];

  const body = (
    <Animated.View
      style={[
        styles.card,
        padded ? styles.padded : null,
        variantStyle,
        disabled ? styles.disabled : null,
        onPress && !disabled ? animatedStyle : null,
        style,
      ]}
    >
      {children}
    </Animated.View>
  );

  if (!onPress || disabled) return body;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing.base,
  },
  disabled: {
    opacity: 0.55,
  },
});
