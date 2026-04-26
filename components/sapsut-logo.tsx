import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

export type SapsutLogoProps = {
  width?: number;
  height?: number;
};

export function SapsutLogo({ width = 140, height = 64 }: SapsutLogoProps) {
  return (
    <View style={styles.container}>
      <Image
        source={require('@/assets/images/sapsut-logo-800x360.png')}
        style={{ width, height }}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
