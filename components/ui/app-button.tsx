import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { Button } from 'react-native-paper';

export type AppButtonTone = 'primary' | 'secondary' | 'ghost';

type AppButtonProps = PropsWithChildren<{
  tone?: AppButtonTone;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}>;

export function AppButton({
  children,
  tone = 'primary',
  onPress,
  disabled,
  loading,
  style,
  labelStyle,
}: AppButtonProps) {
  const mode: 'contained' | 'outlined' | 'text' =
    tone === 'primary'
      ? 'contained'
      : tone === 'secondary'
        ? 'outlined'
        : 'text';

  return (
    <Button
      mode={mode}
      onPress={onPress}
      disabled={disabled}
      loading={loading}
      style={[styles.button, style]}
      labelStyle={[styles.label, labelStyle]}
      contentStyle={styles.content}
    >
      {children}
    </Button>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 999,
  },
  content: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  label: {
    fontSize: 14,
  },
});
