import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { SafeScreen } from '@/components/safe-screen';
import {
  AppButton,
  AppCard,
  AppChip,
  AppInput,
  AppText,
  IconSymbol,
  NavBar,
  Skeleton,
} from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { toAppError } from '@/lib/app-error';
import { joinTeam, leaveTeam, useTeamSession } from '@/lib/team-session';
import { useAppTheme } from '@/lib/ui';

export default function TeamScreen() {
  const { colors } = useAppTheme();
  const { session, isLoading } = useTeamSession();

  const [codeDraft, setCodeDraft] = useState('');
  // A wrong code (404) is a field error; connection and server problems are a
  // separate notice so the typed code is kept and Join simply retries.
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onJoin = useCallback(async () => {
    if (isJoining) return;
    const code = codeDraft.trim().toUpperCase();
    if (!code) {
      const message = 'Enter your team invite code.';
      setFieldError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    setFieldError(null);
    setNotice(null);
    setIsJoining(true);
    try {
      await joinTeam(code);
    } catch (e) {
      if (!mountedRef.current) return;
      const err = toAppError(e);
      const message =
        err.message ?? "Couldn't join the team. Try again in a moment.";
      if (err.status === 404) setFieldError(message);
      else setNotice(message);
      AccessibilityInfo.announceForAccessibility(message);
      setIsJoining(false);
      return;
    }
    if (!mountedRef.current) return;
    setCodeDraft('');
    setIsJoining(false);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [codeDraft, isJoining]);

  const onLeave = useCallback(async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    try {
      await leaveTeam();
    } finally {
      if (mountedRef.current) {
        setIsLeaving(false);
        setConfirmingLeave(false);
      }
    }
  }, [isLeaving]);

  const teamName = session?.teamName.trim() || 'Unnamed team';

  return (
    <SafeScreen>
      <NavBar title="Team" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={Spacing.xxl}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {isLoading ? (
            <Skeleton height={140} />
          ) : session && !isJoining ? (
            <Animated.View entering={FadeInDown.duration(280)}>
              <AppCard>
                <View
                  style={styles.row}
                  accessible
                  accessibilityLabel={`Your team, ${teamName}, joined`}
                >
                  <View
                    style={[
                      styles.iconWrap,
                      { backgroundColor: colors.accentSoft },
                    ]}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <IconSymbol
                      name="person.2.fill"
                      size={17}
                      color={colors.accent}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <AppText variant="overline" tone="secondary">
                      Your team
                    </AppText>
                    <AppText variant="title" accessibilityRole="header">
                      {teamName}
                    </AppText>
                  </View>
                  <AppChip tone="accent">Joined</AppChip>
                </View>

                {confirmingLeave ? (
                  <View style={styles.confirm}>
                    <AppText variant="callout" tone="secondary">
                      Leave this team? You&apos;ll need the invite code to
                      rejoin.
                    </AppText>
                    <AppButton
                      tone="danger"
                      size="md"
                      fullWidth
                      onPress={onLeave}
                      loading={isLeaving}
                    >
                      Leave team
                    </AppButton>
                    <AppButton
                      tone="ghost"
                      size="md"
                      fullWidth
                      onPress={() => setConfirmingLeave(false)}
                      disabled={isLeaving}
                    >
                      Cancel
                    </AppButton>
                  </View>
                ) : (
                  <>
                    <AppText
                      variant="callout"
                      tone="secondary"
                      style={styles.hint}
                    >
                      Submissions from this device count for this team. Leave to
                      join a different team.
                    </AppText>

                    <View style={styles.action}>
                      <AppButton
                        tone="secondary"
                        size="md"
                        fullWidth
                        onPress={() => setConfirmingLeave(true)}
                      >
                        Leave team
                      </AppButton>
                    </View>
                  </>
                )}
              </AppCard>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInDown.duration(280)}>
              <AppCard style={styles.joinCard}>
                <View style={styles.row}>
                  <View
                    style={[
                      styles.iconWrap,
                      { backgroundColor: colors.accentSoft },
                    ]}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <IconSymbol
                      name="person.2.fill"
                      size={17}
                      color={colors.accent}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <AppText variant="title" accessibilityRole="header">
                      Join your team
                    </AppText>
                    <AppText variant="caption" tone="secondary">
                      Ask your organizer for the invite code.
                    </AppText>
                  </View>
                </View>

                <AppInput
                  label="Invite code"
                  accessibilityLabel="Invite code"
                  value={codeDraft}
                  onChangeText={(t) => {
                    setCodeDraft(t.toUpperCase());
                    if (fieldError) setFieldError(null);
                    if (notice) setNotice(null);
                  }}
                  placeholder="e.g. K7M2QX9P"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  textContentType="none"
                  returnKeyType="go"
                  onSubmitEditing={onJoin}
                  editable={!isJoining}
                  error={fieldError ?? undefined}
                  hint={
                    codeDraft.trim()
                      ? undefined
                      : "Ask your organizer for your team's invite code."
                  }
                />

                {notice ? (
                  <View
                    style={[
                      styles.notice,
                      { backgroundColor: colors.dangerSoft },
                    ]}
                    accessibilityRole="alert"
                  >
                    <View
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <IconSymbol
                        name="wifi.slash"
                        size={17}
                        color={colors.danger}
                      />
                    </View>
                    <View style={styles.noticeBody}>
                      <AppText variant="callout" tone="danger">
                        {notice}
                      </AppText>
                    </View>
                  </View>
                ) : null}

                <View style={styles.action}>
                  <AppButton
                    tone="primary"
                    fullWidth
                    onPress={onJoin}
                    loading={isJoining}
                    disabled={!codeDraft.trim()}
                  >
                    Join team
                  </AppButton>
                </View>
              </AppCard>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    gap: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  joinCard: {
    gap: Spacing.base,
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
  hint: {
    marginTop: Spacing.base,
  },
  action: {
    marginTop: Spacing.xs,
  },
  confirm: {
    marginTop: Spacing.base,
    gap: Spacing.md,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.sm,
  },
  noticeBody: {
    flex: 1,
  },
});
