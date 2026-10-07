import { PropsWithChildren } from 'react';
import { AccessibilityRole, StyleProp, Text, TextStyle } from 'react-native';

import { Typography, TypographyVariant } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';

export type AppTextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'inverse'
  | 'success'
  | 'warning'
  | 'danger';

type AppTextProps = PropsWithChildren<{
  variant?: TypographyVariant;
  tone?: AppTextTone;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<TextStyle>;
}>;

export function AppText({
  variant = 'body',
  tone = 'primary',
  align,
  numberOfLines,
  accessibilityRole,
  style,
  children,
}: AppTextProps) {
  const { colors } = useAppTheme();

  const color = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    inverse: colors.textInverse,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[tone];

  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      style={[Typography[variant], { color, textAlign: align }, style]}
    >
      {children}
    </Text>
  );
}
