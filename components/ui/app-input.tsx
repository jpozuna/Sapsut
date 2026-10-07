import { useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';
import { AppText } from './app-text';

type AppInputProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export function AppInput({
  label,
  hint,
  error,
  containerStyle,
  multiline,
  style,
  onFocus,
  onBlur,
  ...rest
}: AppInputProps) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? colors.danger
    : focused
      ? colors.accent
      : colors.border;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <AppText variant="label" tone="secondary">
          {label}
        </AppText>
      ) : null}

      <TextInput
        {...rest}
        multiline={multiline}
        placeholderTextColor={colors.textTertiary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          Typography.body,
          {
            color: colors.textPrimary,
            backgroundColor: colors.surface,
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
          },
          multiline ? styles.multiline : null,
          style,
        ]}
      />

      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="tertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
  },
  input: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    minHeight: 50,
  },
  multiline: {
    minHeight: 120,
    paddingTop: Spacing.md,
    textAlignVertical: 'top',
  },
});
