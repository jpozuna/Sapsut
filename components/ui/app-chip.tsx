import { StyleProp, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { Chip, useTheme } from 'react-native-paper';

export type AppChipTone = 'default' | 'accent' | 'success' | 'danger';

type AppChipProps = {
  children: string;
  tone?: AppChipTone;
  selected?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function AppChip({
  children,
  tone = 'default',
  selected = false,
  compact = true,
  style,
  textStyle,
}: AppChipProps) {
  const theme = useTheme();
  const mode: 'outlined' | 'flat' = selected ? 'flat' : 'outlined';

  const toneColor =
    tone === 'accent'
      ? theme.colors.primary
      : tone === 'success'
        ? '#2E7D32'
        : tone === 'danger'
          ? '#C62828'
          : theme.colors.onSurface;

  const chipStyle: StyleProp<ViewStyle> = selected
    ? { backgroundColor: toneColor, borderColor: toneColor }
    : { borderColor: tone === 'default' ? theme.colors.outline : toneColor };

  const chipTextStyle: StyleProp<TextStyle> = selected
    ? { color: theme.colors.onPrimary }
    : { color: tone === 'default' ? theme.colors.onSurface : toneColor };

  return (
    <Chip
      mode={mode}
      compact={compact}
      style={[styles.chip, chipStyle, style]}
      textStyle={[chipTextStyle, textStyle]}
    >
      {children}
    </Chip>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
  },
});

