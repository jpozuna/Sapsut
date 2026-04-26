import { StyleSheet, View } from 'react-native';

import Logo from '@/assets/images/Sapsut-Logo.svg';

export type SapsutLogoProps = {
  width?: number;
  height?: number;
};

export function SapsutLogo({ width = 140, height = 64 }: SapsutLogoProps) {
  return (
    <View style={styles.container}>
      <Logo width={width} height={height} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
