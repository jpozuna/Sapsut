import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { textStyles, useAppTheme } from '@/lib/ui';

export type AppLoadingProps = {
  label?: string;
  fullScreen?: boolean;
};

export function AppLoading({
  label = 'Loading…',
  fullScreen = true,
}: AppLoadingProps) {
  const { tint: spinnerColor, textColor, backgroundColor } = useAppTheme();

  const content = (
    <View style={styles.content}>
      <ActivityIndicator size="large" color={spinnerColor} />
      {label ? (
        <Text style={[textStyles.default, styles.label, { color: textColor }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );

  if (!fullScreen) return content;

  return (
    <View style={[styles.fullScreen, { backgroundColor }]}>{content}</View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    gap: 12,
  },
  label: {
    textAlign: 'center',
    opacity: 0.9,
  },
});
