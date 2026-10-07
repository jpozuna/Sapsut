import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';

/** Vertical space the floating tab bar occupies above the safe-area inset. */
export const TAB_BAR_CLEARANCE = 92;

export function SafeScreen(props: {
  children: ReactNode;
  /** Defaults to the theme canvas. */
  backgroundColor?: string;
  /** Horizontal screen gutter. Disable for edge-to-edge content. */
  gutter?: boolean;
  /** Reserve room so content clears the floating tab bar. */
  clearTabBar?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useAppTheme();
  const { gutter = true, clearTabBar = false } = props;

  return (
    <SafeAreaView
      edges={['top']}
      style={[
        styles.container,
        { backgroundColor: props.backgroundColor ?? colors.canvas },
      ]}
    >
      <View
        style={[
          styles.inner,
          gutter ? styles.gutter : null,
          clearTabBar ? { paddingBottom: TAB_BAR_CLEARANCE } : null,
          props.style,
        ]}
      >
        {props.children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingTop: Spacing.sm,
  },
  gutter: {
    paddingHorizontal: Spacing.lg,
  },
});
