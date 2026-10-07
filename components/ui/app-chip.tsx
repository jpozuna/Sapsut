import { ReactNode } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';

export type AppChipTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'brick';

type AppChipProps = {
  children: string;
  tone?: AppChipTone;
  /** Solid fill instead of the default tinted background. */
  solid?: boolean;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function AppChip({
  children,
  tone = 'neutral',
  solid = false,
  size = 'sm',
  icon,
  style,
  textStyle,
}: AppChipProps) {
  const { colors } = useAppTheme();

  const toneMap = {
    neutral: {
      bg: colors.surfaceSunken,
      fg: colors.textSecondary,
      solidBg: colors.surfaceInverse,
      solidFg: colors.textInverse,
    },
    accent: {
      bg: colors.accentSoft,
      fg: colors.accentOnSoft,
      solidBg: colors.accent,
      solidFg: colors.onAccent,
    },
    success: {
      bg: colors.successSoft,
      fg: colors.onSuccessSoft,
      solidBg: colors.success,
      solidFg: colors.onAccent,
    },
    warning: {
      bg: colors.warningSoft,
      fg: colors.onWarningSoft,
      solidBg: colors.warning,
      solidFg: colors.onAccent,
    },
    danger: {
      bg: colors.dangerSoft,
      fg: colors.onDangerSoft,
      solidBg: colors.danger,
      solidFg: colors.onAccent,
    },
    brick: {
      bg: colors.brickSoft,
      fg: colors.onBrickSoft,
      solidBg: colors.brick,
      solidFg: colors.onAccent,
    },
  }[tone];

  return (
    <View
      style={[
        styles.chip,
        size === 'md' ? styles.chipMd : styles.chipSm,
        { backgroundColor: solid ? toneMap.solidBg : toneMap.bg },
        style,
      ]}
    >
      {icon}
      <Text
        numberOfLines={1}
        style={[
          size === 'md' ? Typography.label : Typography.caption,
          styles.text,
          { color: solid ? toneMap.solidFg : toneMap.fg },
          textStyle,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    gap: Spacing.xs,
  },
  chipSm: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
  },
  chipMd: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm - 1,
  },
  text: {
    fontFamily: Typography.label.fontFamily,
  },
});
