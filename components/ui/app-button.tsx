import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';
import { usePressScale } from './use-press-scale';

export type AppButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';
export type AppButtonSize = 'sm' | 'md' | 'lg';

type AppButtonProps = {
  children: string;
  tone?: AppButtonTone;
  size?: AppButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

const SIZES: Record<
  AppButtonSize,
  { height: number; paddingHorizontal: number; text: TextStyle }
> = {
  sm: { height: 38, paddingHorizontal: Spacing.base, text: Typography.label },
  md: { height: 48, paddingHorizontal: Spacing.xl, text: Typography.title },
  lg: { height: 56, paddingHorizontal: Spacing.xl, text: Typography.title },
};

export function AppButton({
  children,
  tone = 'primary',
  size = 'md',
  onPress,
  disabled = false,
  loading = false,
  fullWidth = false,
  icon,
  accessibilityLabel,
  style,
  labelStyle,
}: AppButtonProps) {
  const { colors } = useAppTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale();

  const isInert = disabled || loading;
  const sizing = SIZES[size];

  const toneStyles = {
    primary: {
      backgroundColor: colors.accent,
      borderColor: 'transparent',
      color: colors.onAccent,
    },
    secondary: {
      backgroundColor: 'transparent',
      borderColor: colors.borderStrong,
      color: colors.textPrimary,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: colors.accent,
    },
    danger: {
      backgroundColor: colors.danger,
      borderColor: 'transparent',
      color: colors.onAccent,
    },
  }[tone];

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={isInert}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInert, busy: loading }}
      accessibilityLabel={accessibilityLabel ?? children}
      style={fullWidth ? styles.fullWidth : styles.autoWidth}
    >
      <Animated.View
        style={[
          styles.base,
          {
            height: sizing.height,
            paddingHorizontal: sizing.paddingHorizontal,
            backgroundColor: toneStyles.backgroundColor,
            borderColor: toneStyles.borderColor,
            borderWidth: tone === 'secondary' ? 1.5 : 0,
            opacity: isInert ? 0.45 : 1,
          },
          animatedStyle,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={toneStyles.color} />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text
              numberOfLines={1}
              style={[sizing.text, { color: toneStyles.color }, labelStyle]}
            >
              {children}
            </Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fullWidth: { width: '100%' },
  autoWidth: { alignSelf: 'flex-start' },
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
