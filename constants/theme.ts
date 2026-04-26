/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

// Brand tokens (light)
const brandBackgroundLight = '#FEF3E2';
const brandAccentOrange = '#E8821A';
const brandBrown = '#3D2B1A';
const brandBrick = '#B84C2B';

const tintColorLight = brandAccentOrange;
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: brandBrown,
    background: brandBackgroundLight,
    tint: tintColorLight,
    icon: brandBrick,
    tabIconDefault: brandBrick,
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    // Loaded via expo-font in `app/_layout.tsx`
    sans: 'JosefinSans_400Regular',
    serif: 'JosefinSlab_400Regular',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'JosefinSans_400Regular',
    serif: 'JosefinSlab_400Regular',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    // Keep web on system fonts unless you add CSS font loading.
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
