import { PropsWithChildren } from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { Text } from 'react-native-paper';

export type AppTextVariant = 'title' | 'subtitle' | 'body' | 'label';

type AppTextProps = PropsWithChildren<{
  variant?: AppTextVariant;
  style?: StyleProp<TextStyle>;
}>;

export function AppText({ variant = 'body', style, children }: AppTextProps) {
  const paperVariant =
    variant === 'title'
      ? 'headlineMedium'
      : variant === 'subtitle'
        ? 'titleLarge'
        : variant === 'label'
          ? 'labelLarge'
          : 'bodyLarge';

  return (
    <Text variant={paperVariant} style={style}>
      {children}
    </Text>
  );
}
