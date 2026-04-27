import { StyleSheet } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type AppThemeName = keyof typeof Colors;

export function useAppTheme() {
  const theme = (useColorScheme() ?? 'light') as AppThemeName;
  const colors = Colors[theme];

  return {
    theme,
    colors,
    textColor: colors.text,
    backgroundColor: colors.background,
    tint: colors.tint,
    border: colors.icon,
  };
}

export const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
});

export const textStyles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Fonts?.sans,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Fonts?.sans,
  },
  title: {
    fontSize: 32,
    fontFamily: Fonts?.serif,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 20,
    fontFamily: Fonts?.serif,
  },
});
