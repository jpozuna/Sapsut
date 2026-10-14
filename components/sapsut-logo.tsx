import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import SapsutLogoDark from '@/assets/images/sapsut-logo-dark.svg';
import { useAppTheme } from '@/lib/ui';

export type SapsutLogoProps = {
  width?: number;
  height?: number;
};

export function SapsutLogo({ width = 140, height = 64 }: SapsutLogoProps) {
  const { isDark } = useAppTheme();

  return (
    <View style={styles.container}>
      {isDark ? (
        // The husky's dark linework is recolored light so it reads on the dark canvas.
        <SapsutLogoDark width={width} height={height} />
      ) : (
        <Image
          source={require('@/assets/images/sapsut-logo-800x360.png')}
          style={{ width, height }}
          contentFit="contain"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
