import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { SafeScreen, TAB_BAR_CLEARANCE } from '@/components/safe-screen';
import { ScreenState } from '@/components/screen-state';
import {
  AppButton,
  AppCard,
  AppChip,
  AppInput,
  AppText,
  IconSymbol,
  ScreenHeader,
} from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Radius, Spacing } from '@/constants/theme';
import { toAppError } from '@/lib/app-error';
import { useRole } from '@/lib/role-context';
import { useAppTheme } from '@/lib/ui';

export default function SettingsScreen() {
  const { colors } = useAppTheme();

  const { role, isHydrating, enterOrganizerMode, exitOrganizerMode } =
    useRole();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const modeLabel = useMemo(() => {
    return role === 'organizer' ? 'Organizer' : 'Participant';
  }, [role]);

  const openOrganizerPrompt = useCallback(() => {
    // The stored session is still being verified; signing in now would race it.
    if (isHydrating) return;
    setError(null);
    setCodeDraft('');
    setIsModalOpen(true);
  }, [isHydrating]);

  const onConfirmOrganizer = useCallback(async () => {
    if (isSubmitting) return;
    const code = codeDraft.trim();
    if (!code) {
      setError('Enter an organizer code.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await enterOrganizerMode(code);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(toAppError(e).message ?? 'Organizer sign-in failed. Try again.');
      setIsSubmitting(false);
      return;
    }
    if (!mountedRef.current) return;
    // The code is only needed for the exchange; do not keep it in state.
    setCodeDraft('');
    setIsSubmitting(false);
    setIsModalOpen(false);
    router.push('/(tabs)/organizer');
  }, [codeDraft, enterOrganizerMode, isSubmitting]);

  const onCancelOrganizer = useCallback(() => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setCodeDraft('');
    setError(null);
  }, [isSubmitting]);

  const onSwitchToParticipant = useCallback(() => {
    exitOrganizerMode();
    router.replace('/(tabs)');
  }, [exitOrganizerMode]);

  const isOrganizer = role === 'organizer';
  const modeIcon: IconSymbolName = isOrganizer ? 'lock.fill' : 'person.fill';

  return (
    <ScreenState isLoading={false}>
      <SafeScreen>
        <ScreenHeader
          title="Settings"
          subtitle={`You're browsing Sapsut as ${isOrganizer ? 'an organizer' : 'a participant'}.`}
          rightSlot={
            <AppChip tone={isOrganizer ? 'brick' : 'accent'} size="md">
              {modeLabel}
            </AppChip>
          }
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Animated.View
            entering={FadeInDown.duration(280)}
            style={styles.section}
          >
            <AppText variant="overline" tone="tertiary">
              Account
            </AppText>

            <AppCard>
              <View style={styles.row}>
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <IconSymbol name={modeIcon} size={17} color={colors.accent} />
                </View>

                <View style={styles.rowBody}>
                  <AppText variant="title">Current mode</AppText>
                  <AppText variant="caption" tone="secondary">
                    {isOrganizer
                      ? 'Organizer tools and review queues are unlocked.'
                      : 'Standard hunt experience for your team.'}
                  </AppText>
                </View>

                <AppChip tone={isOrganizer ? 'brick' : 'neutral'}>
                  {modeLabel}
                </AppChip>
              </View>
            </AppCard>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(45).duration(280)}
            style={styles.section}
          >
            <AppText variant="overline" tone="tertiary">
              Role
            </AppText>

            <AppCard>
              <AppText variant="title">
                {isOrganizer ? 'Leave organizer mode' : 'Organizer access'}
              </AppText>
              <AppText
                variant="callout"
                tone="secondary"
                style={styles.cardHint}
              >
                Switch between participant views and organizer tools.
              </AppText>

              <View style={styles.cardAction}>
                {isOrganizer ? (
                  <AppButton
                    tone="secondary"
                    size="sm"
                    onPress={onSwitchToParticipant}
                    icon={
                      <IconSymbol
                        name="person.fill"
                        size={14}
                        color={colors.textPrimary}
                      />
                    }
                  >
                    Switch to Participant
                  </AppButton>
                ) : (
                  <AppButton
                    tone="primary"
                    size="sm"
                    onPress={openOrganizerPrompt}
                    disabled={isHydrating}
                    icon={
                      <IconSymbol
                        name="lock.fill"
                        size={14}
                        color={colors.onAccent}
                      />
                    }
                  >
                    Switch to Organizer
                  </AppButton>
                )}
              </View>
            </AppCard>
          </Animated.View>
        </ScrollView>

        <Modal
          visible={isModalOpen}
          transparent
          animationType="fade"
          onRequestClose={onCancelOrganizer}
        >
          <View
            style={[styles.modalBackdrop, { backgroundColor: colors.scrim }]}
          >
            <AppCard style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <IconSymbol
                    name="lock.fill"
                    size={17}
                    color={colors.accent}
                  />
                </View>
                <View style={styles.rowBody}>
                  <AppText variant="title">Enter organizer code</AppText>
                  <AppText variant="caption" tone="secondary">
                    Stays signed in on this device for up to 24 hours, or until
                    you switch back to participant.
                  </AppText>
                </View>
              </View>

              <AppInput
                label="Organizer code"
                value={codeDraft}
                onChangeText={(t) => {
                  setCodeDraft(t);
                  if (error) setError(null);
                }}
                placeholder="Organizer code"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                error={error ?? undefined}
                containerStyle={styles.modalInput}
              />

              <View style={styles.modalActions}>
                <AppButton
                  tone="ghost"
                  size="sm"
                  onPress={onCancelOrganizer}
                  disabled={isSubmitting}
                >
                  Cancel
                </AppButton>
                <AppButton
                  tone="primary"
                  size="sm"
                  onPress={onConfirmOrganizer}
                  loading={isSubmitting}
                >
                  Continue
                </AppButton>
              </View>
            </AppCard>
          </View>
        </Modal>
      </SafeScreen>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    gap: Spacing.xl,
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  section: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: Spacing.xxs,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHint: {
    marginTop: Spacing.xs,
  },
  cardAction: {
    marginTop: Spacing.base,
    alignSelf: 'flex-start',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    gap: Spacing.base,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  modalInput: {
    marginTop: Spacing.xxs,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
