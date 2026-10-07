import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText, IconSymbol } from '@/components/ui';
import { elevation, HitSlop, Motion, Radius, Spacing } from '@/constants/theme';
import { isSameSort, TASK_SORT_OPTIONS, type TaskSort } from '@/lib/task-sort';
import { useAppTheme } from '@/lib/ui';

const MIN_TOUCH = 44;
const OPTION_HEIGHT = 52;
const HANDLE = { width: 36, height: 5 };
const SHEET_MAX_HEIGHT_RATIO = 0.8;

type TaskSortBarProps = {
  value: TaskSort;
  onChange: (next: TaskSort) => void;
  /** Hide the completion sorts (organizers have no submissions). */
  showStatus?: boolean;
};

export function TaskSortBar({
  value,
  onChange,
  showStatus = true,
}: TaskSortBarProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const [isOpen, setIsOpen] = useState(false);

  // Read through a ref so a window resize doesn't replay the open animation.
  const windowHeightRef = useRef(windowHeight);
  windowHeightRef.current = windowHeight;

  // Sheet offset from its resting position; 0 = fully open.
  const translateY = useSharedValue(windowHeight);
  const sheetHeight = useSharedValue(windowHeight);

  const options = showStatus
    ? TASK_SORT_OPTIONS
    : TASK_SORT_OPTIONS.filter((o) => o.key !== 'status');
  const current =
    options.find((o) => isSameSort(o, value)) ?? TASK_SORT_OPTIONS[0];
  const isDefault = current.key === 'default';
  const triggerColor = isDefault ? colors.textSecondary : colors.accentOnSoft;

  useEffect(() => {
    if (!isOpen) return;
    if (reduceMotion) {
      translateY.value = 0;
      return;
    }
    translateY.value = Math.min(sheetHeight.value, windowHeightRef.current);
    translateY.value = withTiming(0, { duration: Motion.base });
  }, [isOpen, reduceMotion, sheetHeight, translateY]);

  const close = useCallback(() => {
    if (reduceMotion) {
      setIsOpen(false);
      return;
    }
    translateY.value = withTiming(
      sheetHeight.value,
      { duration: Motion.base },
      (finished) => {
        if (finished) scheduleOnRN(setIsOpen, false);
      },
    );
  }, [reduceMotion, sheetHeight, translateY]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onUpdate((e) => {
          translateY.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          const shouldClose =
            e.translationY > sheetHeight.value * 0.3 || e.velocityY > 900;
          if (shouldClose) {
            translateY.value = withTiming(
              sheetHeight.value,
              { duration: Motion.fast },
              (finished) => {
                if (finished) scheduleOnRN(setIsOpen, false);
              },
            );
          } else {
            translateY.value = withSpring(0, { damping: 22, stiffness: 260 });
          }
        }),
    [sheetHeight, translateY],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [0, sheetHeight.value],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => setIsOpen(true)}
        hitSlop={HitSlop}
        accessibilityRole="button"
        accessibilityLabel={`Sort tasks. Currently ${current.label}`}
        style={({ pressed }) => [
          styles.trigger,
          isDefault
            ? { borderColor: colors.border, backgroundColor: colors.surface }
            : {
                borderColor: colors.accentSoft,
                backgroundColor: colors.accentSoft,
              },
          pressed ? styles.triggerPressed : null,
        ]}
      >
        <IconSymbol name="arrow.up.arrow.down" size={14} color={triggerColor} />
        <AppText
          variant="label"
          numberOfLines={1}
          style={[styles.shrink, { color: triggerColor }]}
        >
          {isDefault ? 'Sort' : current.label}
        </AppText>
        <IconSymbol name="chevron.down" size={14} color={triggerColor} />
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType={reduceMotion ? 'fade' : 'none'}
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={close}
      >
        <GestureHandlerRootView style={styles.sheetRoot}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.scrim },
              scrimStyle,
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close sort options"
            />
          </Animated.View>

          <Animated.View
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            onLayout={(e) => {
              sheetHeight.value = e.nativeEvent.layout.height;
            }}
            style={[
              styles.sheet,
              elevation(3, colors.shadow),
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                maxHeight: windowHeight * SHEET_MAX_HEIGHT_RATIO,
                paddingBottom: Math.max(insets.bottom, Spacing.base),
              },
              sheetStyle,
            ]}
          >
            {/* Drag area: the pan lives here so it doesn't fight list scrolling. */}
            <GestureDetector gesture={pan}>
              <View style={styles.sheetHeader}>
                <View
                  style={[
                    styles.handle,
                    { backgroundColor: colors.borderStrong },
                  ]}
                />
                <View style={styles.sheetTitleRow}>
                  <AppText variant="title" accessibilityRole="header">
                    Sort by
                  </AppText>
                  <Pressable
                    onPress={close}
                    hitSlop={HitSlop}
                    accessibilityRole="button"
                    style={styles.doneButton}
                  >
                    <AppText
                      variant="label"
                      style={{ color: colors.accentOnSoft }}
                    >
                      Done
                    </AppText>
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              accessibilityRole="radiogroup"
            >
              {options.map((option, index) => {
                const isSelected = isSameSort(option, current);
                const isLast = index === options.length - 1;
                return (
                  <Pressable
                    key={`${option.key}-${option.direction}`}
                    onPress={() => {
                      onChange({
                        key: option.key,
                        direction: option.direction,
                      });
                      close();
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    style={({ pressed }) => [
                      styles.option,
                      isLast
                        ? null
                        : {
                            borderBottomColor: colors.border,
                            borderBottomWidth: StyleSheet.hairlineWidth,
                          },
                      pressed
                        ? { backgroundColor: colors.surfaceSunken }
                        : null,
                    ]}
                  >
                    <AppText
                      variant={isSelected ? 'bodyStrong' : 'body'}
                      style={styles.shrink}
                    >
                      {option.label}
                    </AppText>
                    {isSelected ? (
                      <IconSymbol
                        name="checkmark"
                        size={18}
                        color={colors.accentOnSoft}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: Spacing.md,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.base,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  triggerPressed: {
    opacity: 0.8,
  },
  shrink: {
    flexShrink: 1,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetHeader: {
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: HANDLE.width,
    height: HANDLE.height,
    borderRadius: Radius.pill,
    marginBottom: Spacing.sm,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  doneButton: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingLeft: Spacing.base,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    minHeight: OPTION_HEIGHT,
    paddingHorizontal: Spacing.lg,
  },
});
