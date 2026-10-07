import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { SafeScreen, TAB_BAR_CLEARANCE } from '@/components/safe-screen';
import {
  AppButton,
  AppCard,
  AppChip,
  AppInput,
  AppText,
  IconSymbol,
  NavBar,
  SkeletonCard,
} from '@/components/ui';
import {
  FontFamily,
  HitSlop,
  Radius,
  Spacing,
  Typography,
} from '@/constants/theme';
import { toAppError } from '@/lib/app-error';
import { organizerJson } from '@/lib/organizer-api';
import { useAppTheme } from '@/lib/ui';

type Team = {
  id: string;
  name: string;
  invite_code: string;
  total_score: number | null;
  created_at: string | null;
};

type CreatedTeam = {
  id: string;
  name: string;
  invite_code: string;
};

const NAME_MAX = 80;
const NAME_ERROR = `Enter a team name between 1 and ${NAME_MAX} characters.`;

// Screen readers would read "K7M2QX9P" as one odd word, so spell it out.
function spellCode(code: string): string {
  return code.split('').join(' ');
}

/**
 * Invite codes let any holder act as that team, so they are shown large and
 * selectable (long-press to copy) but never logged or put in navigation.
 */
function InviteCode({ code, teamName }: { code: string; teamName: string }) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.codeBox, { backgroundColor: colors.surfaceSunken }]}>
      <Text
        selectable
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        maxFontSizeMultiplier={1.3}
        accessibilityLabel={`Invite code for ${teamName}: ${spellCode(code)}`}
        style={[styles.codeText, { color: colors.textPrimary }]}
      >
        {code}
      </Text>
    </View>
  );
}

export default function OrganizerTeamsScreen() {
  const { colors } = useAppTheme();

  const [nameDraft, setNameDraft] = useState('');
  // A bad name is a field error; connection and server problems are a
  // separate notice so the typed name is kept and Create simply retries.
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<{
    message: string;
    icon: NoticeIcon;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState<CreatedTeam | null>(null);

  const [teams, setTeams] = useState<Team[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  // True on the first frame so skeletons show before the first request starts.
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const creatingRef = useRef(false);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(0);
  const listRef = useRef<FlatList<Team>>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 'quiet' reloads without any spinner (used right after a create).
  const loadTeams = useCallback(
    async (mode: 'initial' | 'refresh' | 'quiet') => {
      const requestId = ++requestIdRef.current;
      inFlightRef.current += 1;
      if (mode === 'refresh') setIsRefreshing(true);
      else if (mode === 'initial') setIsLoading(true);
      setListError(null);
      try {
        const data = await organizerJson<Team[]>('/teams/');
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setTeams(Array.isArray(data) ? data : []);
        setHasLoaded(true);
      } catch (e) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        const err = toAppError(e);
        setListError(
          err.kind === 'network'
            ? "Can't reach the server. Check your connection and try again."
            : "Couldn't load teams. Pull down to try again.",
        );
      } finally {
        // Data is applied only for the latest request, but spinners clear when
        // the last in-flight request settles so a superseded one can't strand
        // them.
        inFlightRef.current -= 1;
        if (mountedRef.current && inFlightRef.current === 0) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      // Reload on focus so teams made elsewhere (or scores) are current.
      loadTeams('initial').catch(() => {});
      // The new-team code is sensitive, so don't leave it on screen after
      // navigating away.
      return () => setCreated(null);
    }, [loadTeams]),
  );

  const onCreate = useCallback(async () => {
    if (creatingRef.current) return;
    const name = nameDraft.trim();
    if (name.length < 1 || name.length > NAME_MAX) {
      setFieldError(NAME_ERROR);
      AccessibilityInfo.announceForAccessibility(NAME_ERROR);
      return;
    }
    creatingRef.current = true;
    setFieldError(null);
    setCreateNotice(null);
    setIsCreating(true);
    try {
      const row = await organizerJson<CreatedTeam>('/teams/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!mountedRef.current) return;
      setCreated(row);
      setNameDraft('');
      Keyboard.dismiss();
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      AccessibilityInfo.announceForAccessibility(
        `Team ${row.name} created. Invite code ${spellCode(row.invite_code)}.`,
      );
      loadTeams('quiet').catch(() => {});
    } catch (e) {
      if (!mountedRef.current) return;
      const err = toAppError(e);
      if (err.status === 422) {
        setFieldError(NAME_ERROR);
        AccessibilityInfo.announceForAccessibility(NAME_ERROR);
      } else {
        const isNetwork = err.kind === 'network';
        const message = isNetwork
          ? "Can't reach the server. Check your connection and try again."
          : "Couldn't create the team. Try again in a moment.";
        setCreateNotice({
          message,
          icon: isNetwork ? 'wifi.slash' : 'exclamationmark.triangle.fill',
        });
        AccessibilityInfo.announceForAccessibility(message);
      }
    } finally {
      creatingRef.current = false;
      if (mountedRef.current) setIsCreating(false);
    }
  }, [loadTeams, nameDraft]);

  const onRefresh = useCallback(() => {
    loadTeams('refresh').catch(() => {});
  }, [loadTeams]);

  const onGoToCreate = useCallback(() => router.push('/(tabs)/organizer'), []);
  const onGoToReview = useCallback(
    () => router.push('/(tabs)/organizer/review'),
    [],
  );
  const onGoToHistory = useCallback(
    () => router.push('/(tabs)/organizer/history'),
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Team; index: number }) => {
      const name = item.name.trim() || 'Unnamed team';
      const score = item.total_score ?? 0;
      return (
        <Animated.View
          entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(280)}
        >
          <AppCard variant="outlined">
            <View style={styles.row}>
              <View style={styles.rowBody}>
                <AppText variant="title" numberOfLines={2}>
                  {name}
                </AppText>
              </View>
              <View
                style={styles.scoreBlock}
                accessible
                accessibilityLabel={`${score} points`}
              >
                <AppText variant="numeric">{String(score)}</AppText>
                <AppText variant="overline" tone="tertiary">
                  pts
                </AppText>
              </View>
            </View>
            <InviteCode code={item.invite_code} teamName={name} />
          </AppCard>
        </Animated.View>
      );
    },
    [],
  );

  const header = (
    <View style={styles.header}>
      <View style={[styles.segment, { backgroundColor: colors.surfaceSunken }]}>
        <SegmentButton label="Create" onPress={onGoToCreate} />
        <SegmentButton label="Review" onPress={onGoToReview} />
        <SegmentButton label="History" onPress={onGoToHistory} />
        <SegmentButton label="Teams" active onPress={() => {}} />
      </View>

      <AppCard style={styles.formCard}>
        <View style={styles.row}>
          <View
            style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <IconSymbol name="person.2.fill" size={17} color={colors.accent} />
          </View>
          <View style={styles.rowBody}>
            <AppText variant="title" accessibilityRole="header">
              Create a team
            </AppText>
            <AppText variant="caption" tone="secondary">
              Players join with the invite code you hand them.
            </AppText>
          </View>
        </View>

        <AppInput
          label="Team name"
          accessibilityLabel="Team name"
          value={nameDraft}
          onChangeText={(t) => {
            setNameDraft(t);
            if (fieldError) setFieldError(null);
            if (createNotice) setCreateNotice(null);
          }}
          placeholder="e.g. Husky Hunters"
          maxLength={NAME_MAX}
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={onCreate}
          editable={!isCreating}
          error={fieldError ?? undefined}
          hint={`1 to ${NAME_MAX} characters.`}
        />

        {createNotice ? (
          <Notice message={createNotice.message} icon={createNotice.icon} />
        ) : null}

        <AppButton
          tone="primary"
          fullWidth
          onPress={onCreate}
          loading={isCreating}
          disabled={!nameDraft.trim()}
        >
          Create team
        </AppButton>
      </AppCard>

      {created ? (
        <Animated.View entering={FadeInDown.duration(280)}>
          <AppCard
            variant="outlined"
            style={[styles.createdCard, { borderColor: colors.accent }]}
          >
            <View style={styles.row}>
              <View style={styles.rowBody}>
                <AppText variant="overline" tone="accent">
                  Team created
                </AppText>
                <AppText variant="title" numberOfLines={2}>
                  {created.name}
                </AppText>
              </View>
              <Pressable
                onPress={() => setCreated(null)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss new team invite code"
                hitSlop={HitSlop}
                style={styles.dismiss}
              >
                <IconSymbol
                  name="xmark"
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>
            <InviteCode code={created.invite_code} teamName={created.name} />
            <AppText variant="caption" tone="secondary">
              Anyone with this code can act as this team. Share it only with
              that team.
            </AppText>
          </AppCard>
        </Animated.View>
      ) : null}

      <View style={styles.listHeadingBlock}>
        <View style={styles.listHeading}>
          <AppText variant="heading" accessibilityRole="header">
            All teams
          </AppText>
          {hasLoaded ? (
            <AppChip tone="neutral">{String(teams.length)}</AppChip>
          ) : null}
        </View>
        <AppText variant="caption" tone="secondary">
          Press and hold a code to copy it.
        </AppText>
      </View>

      {listError ? (
        <View style={styles.listError}>
          <Notice message={listError} icon="exclamationmark.triangle.fill" />
          <AppButton
            tone="secondary"
            size="md"
            fullWidth
            onPress={() => {
              loadTeams('initial').catch(() => {});
            }}
            loading={isLoading}
          >
            Try again
          </AppButton>
        </View>
      ) : null}
    </View>
  );

  const showSkeletons = isLoading && !hasLoaded && !listError;
  const showEmpty = hasLoaded && !listError && teams.length === 0;

  return (
    <SafeScreen>
      <NavBar title="Teams" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={Spacing.xxl}
      >
        <FlatList
          ref={listRef}
          data={teams}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            showSkeletons ? (
              <View style={styles.skeletons}>
                <SkeletonCard />
                <SkeletonCard />
              </View>
            ) : showEmpty ? (
              <EmptyState
                icon="person.2.fill"
                title="No teams yet"
                message="Create the first team above and its invite code will show here."
              />
            ) : null
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          refreshing={isRefreshing}
          onRefresh={onRefresh}
        />
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

type NoticeIcon = 'wifi.slash' | 'exclamationmark.triangle.fill';

function Notice({ message, icon }: { message: string; icon: NoticeIcon }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[styles.notice, { backgroundColor: colors.dangerSoft }]}
      accessibilityRole="alert"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <IconSymbol name={icon} size={17} color={colors.danger} />
      </View>
      <View style={styles.rowBody}>
        <AppText variant="callout" style={{ color: colors.onDangerSoft }}>
          {message}
        </AppText>
      </View>
    </View>
  );
}

function SegmentButton({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.segmentItem,
        { backgroundColor: active ? colors.surface : 'transparent' },
      ]}
    >
      <AppText variant="label" tone={active ? 'primary' : 'tertiary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    gap: Spacing.base,
  },
  segment: {
    flexDirection: 'row',
    gap: Spacing.xs,
    padding: Spacing.xs,
    borderRadius: Radius.pill,
  },
  segmentItem: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  formCard: {
    gap: Spacing.base,
  },
  createdCard: {
    gap: Spacing.md,
    borderWidth: 1.5,
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
  dismiss: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBlock: {
    alignItems: 'flex-end',
  },
  codeBox: {
    marginTop: Spacing.md,
    alignItems: 'center',
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
  },
  codeText: {
    ...Typography.numericLarge,
    fontFamily: FontFamily.mono,
    fontWeight: '700',
    letterSpacing: Spacing.xxs,
    textAlign: 'center',
  },
  listHeadingBlock: {
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listError: {
    gap: Spacing.md,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.sm,
  },
  skeletons: {
    gap: Spacing.md,
  },
  list: {
    gap: Spacing.md,
    paddingBottom: TAB_BAR_CLEARANCE + Spacing.base,
  },
});
