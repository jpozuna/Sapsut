import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { Card } from 'react-native-paper';

type AppCardProps = PropsWithChildren<{
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function AppCard({
  children,
  onPress,
  disabled,
  style,
  contentStyle,
}: AppCardProps) {
  return (
    <Card
      mode="outlined"
      onPress={onPress}
      disabled={disabled}
      style={[styles.card, style]}
      contentStyle={contentStyle}
    >
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
  },
});

