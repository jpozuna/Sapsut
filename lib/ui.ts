import { StyleSheet } from 'react-native';

import {
  ColorScheme,
  Palette,
  Spacing,
  ThemeColors,
  Typography,
  elevation,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type AppTheme = {
  scheme: ColorScheme;
  colors: ThemeColors;
  isDark: boolean;
  elevation: (level: 0 | 1 | 2 | 3) => ReturnType<typeof elevation>;
  /** Convenience aliases for the most-reached-for colors. */
  textColor: string;
  backgroundColor: string;
  tint: string;
  border: string;
};

export function useAppTheme(): AppTheme {
  const scheme = (useColorScheme() ?? 'light') as ColorScheme;
  const colors = Palette[scheme];

  return {
    scheme,
    colors,
    isDark: scheme === 'dark',
    elevation: (level) => elevation(level, colors.shadow),
    textColor: colors.textPrimary,
    backgroundColor: colors.canvas,
    tint: colors.accent,
    border: colors.border,
  };
}

export const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gutter: {
    paddingHorizontal: Spacing.lg,
  },
});

/** Legacy alias retained so older call sites keep compiling. */
export const textStyles = StyleSheet.create({
  default: Typography.body,
  defaultSemiBold: Typography.bodyStrong,
  title: Typography.display,
  subtitle: Typography.heading,
});
