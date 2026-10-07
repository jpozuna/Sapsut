import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useAppTheme } from '@/lib/ui';
import { AppText } from './app-text';

type TabOptions = BottomTabBarProps['descriptors'][string]['options'];

/**
 * Expo Router rewrites `href: null` before options reach the tab bar: it
 * destructures `href` away and instead sets a hidden item style plus a
 * `tabBarButton` that renders nothing. A custom tab bar bypasses that button,
 * so both the raw and the rewritten form have to be checked here — otherwise
 * role-gated tabs stay visible.
 */
function isTabHidden(options: TabOptions): boolean {
  if ((options as { href?: string | null }).href === null) return true;
  const itemStyle = StyleSheet.flatten(options.tabBarItemStyle) as
    | { display?: string }
    | undefined;
  return itemStyle?.display === 'none';
}

/** Floating pill tab bar — replaces the stock platform bar. */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { colors, elevation } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { paddingBottom: Math.max(insets.bottom, Spacing.base) },
      ]}
    >
      <View
        style={[
          styles.bar,
          { backgroundColor: colors.surface, borderColor: colors.border },
          elevation(3),
        ]}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];

          if (isTabHidden(options)) return null;

          const isFocused = state.index === index;
          const label =
            typeof options.title === 'string' ? options.title : route.name;
          const color = isFocused ? colors.accent : colors.textTertiary;

          const onPress = () => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              style={styles.tab}
            >
              <View
                style={[
                  styles.iconWrap,
                  isFocused ? { backgroundColor: colors.accentSoft } : null,
                ]}
              >
                {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
              </View>
              <AppText
                variant="caption"
                style={[
                  styles.label,
                  {
                    color,
                    fontFamily: isFocused
                      ? Typography.label.fontFamily
                      : Typography.caption.fontFamily,
                  },
                ]}
              >
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: Spacing.xxs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.md,
    minWidth: 68,
  },
  iconWrap: {
    width: 46,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
  },
});
