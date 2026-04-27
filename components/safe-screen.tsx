import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function SafeScreen(props: {
  children: ReactNode;
  backgroundColor: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView
      edges={['top']}
      style={[
        styles.container,
        { backgroundColor: props.backgroundColor },
        props.style,
      ]}
    >
      {props.children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
});
