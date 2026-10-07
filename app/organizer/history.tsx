import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { SafeScreen } from '@/components/safe-screen';
import {
  AppCard,
  AppChip,
  AppInput,
  AppText,
  IconSymbol,
  NavBar,
  SkeletonCard,
} from '@/components/ui';
import type { AppChipTone } from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Radius, Spacing } from '@/constants/theme';
import { toAppError } from '@/lib/app-error';
import { organizerJson } from '@/lib/organizer-api';
import { useRole } from '@/lib/role-context';
import { useAppTheme } from '@/lib/ui';

type Submission = {
  id: string;
  task_id: string;
  team_id: string;
  text_answer: string | null;
  photo_url: string | null;
  status: string | null;
  score: number | null;
  confidence: number | null;
  rationale: string | null;
  gpt4o_description: string | null;
  created_at: string | null;
};

type ReviewHistoryRow = {
  id: string;
  queue_id: string | null;
  submission_id: string;
  decision: 'approve' | 'override' | string;
  final_score: number | null;
  final_rationale: string | null;
  suggested_score: number | null;
  suggested_rationale: string | null;
  created_at: string | null;
  submission?: Submission | null;
};

function decisionMeta(decision: string): {
  label: string;
  tone: AppChipTone;
  icon: IconSymbolName;
} {
  const d = String(decision || '').trim().toLowerCase();
  if (d === 'approve')
    return {
      label: 'Approved',
      tone: 'success',
      icon: 'hand.thumbsup.fill',
    };
  if (d === 'override')
    return {
      label: 'Overridden',
      tone: 'warning',
      icon: 'square.and.pencil',
    };
  return {
    label: d ? d.toUpperCase() : 'Decision',
    tone: 'neutral',
    icon: 'clock.arrow.circlepath',
  };
}

function formatWhen(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OrganizerHistoryScreen() {
  const { colors } = useAppTheme();
  const {
    role,
    organizerCode: sessionOrganizerCode,
    setOrganizerCode: setSessionOrganizerCode,
    setRole,
  } = useRole();

  const [organizerCode, setOrganizerCode] = useState('');
  const [rows, setRows] = useState<ReviewHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLoad = useMemo(() => Boolean(organizerCode.trim()), [organizerCode]);
  const didPrefillOrganizerCodeRef = useRef(false);
  const didAutoLoadRef = useRef(false);

  useEffect(() => {
    if (didPrefillOrganizerCodeRef.current) return;
    const trimmed = sessionOrganizerCode.trim();
    if (!trimmed) return;
    didPrefillOrganizerCodeRef.current = true;
    setOrganizerCode(trimmed);
  }, [sessionOrganizerCode]);

  useEffect(() => {
    const trimmed = organizerCode.trim();
    const sessionTrimmed = sessionOrganizerCode.trim();
    if (trimmed === sessionTrimmed) return;
    if (trimmed) {
      if (role !== 'organizer') setRole('organizer');
      setSessionOrganizerCode(trimmed);
      return;
    }
    setSessionOrganizerCode('');
  }, [
    organizerCode,
    role,
    sessionOrganizerCode,
    setRole,
    setSessionOrganizerCode,
  ]);

  const loadHistory = useCallback(async () => {
    if (!organizerCode.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await organizerJson<ReviewHistoryRow[]>(
        '/organizer/review-history?limit=100',
        organizerCode,
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(toAppError(e).message ?? 'Failed to load review history.');
    } finally {
      setIsLoading(false);
    }
  }, [organizerCode]);

  useFocusEffect(
    useCallback(() => {
      // Refresh whenever this screen becomes active so new approvals show up immediately.
      if (!organizerCode.trim()) return;
      loadHistory().catch(() => {});
    }, [loadHistory, organizerCode]),
  );

  useEffect(() => {
    setRows([]);
    setError(null);
  }, [organizerCode]);

  useEffect(() => {
    if (!didAutoLoadRef.current && canLoad) {
      didAutoLoadRef.current = true;
      loadHistory().catch(() => {});
    }
  }, [canLoad, loadHistory]);

  const onGoToCreate = useCallback(() => router.push('/(tabs)/organizer'), []);
  const onGoToReview = useCallback(
    () => router.push('/(tabs)/organizer/review'),
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ReviewHistoryRow; index: number }) => {
      const s = item.submission ?? null;
      const content =
        (s?.gpt4o_description ?? '').trim() ||
        (s?.text_answer ?? '').trim() ||
        '(No submission content)';

      const meta = decisionMeta(item.decision);
      const when = formatWhen(item.created_at ?? s?.created_at);
      const team = (s?.team_id ?? '').trim();
      const rationale = (item.final_rationale ?? '').trim();
      const changed =
        item.final_score !== null &&
        item.suggested_score !== null &&
        item.final_score !== item.suggested_score;

      return (
        <Animated.View
          entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(280)}
        >
          <AppCard variant="outlined">
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.surfaceSunken },
                ]}
              >
                <IconSymbol
                  name={meta.icon}
                  size={16}
                  color={colors.textSecondary}
                />
              </View>

              <View style={styles.identity}>
                <AppText variant="title" numberOfLines={1}>
                  {team ? `Team ${team}` : `Submission ${item.submission_id}`}
                </AppText>
                <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                  {when ?? `Submission ${item.submission_id}`}
                </AppText>
              </View>

              <View style={styles.scoreBlock}>
                <AppText variant="numeric">
                  {item.final_score ?? '—'}
                </AppText>
                <AppText variant="overline" tone="tertiary">
                  pts
                </AppText>
              </View>
            </View>

            <View style={styles.chipRow}>
              <AppChip tone={meta.tone}>{meta.label}</AppChip>
              {changed ? (
                <AppChip tone="neutral">
                  {`AI suggested ${item.suggested_score}`}
                </AppChip>
              ) : null}
            </View>

            <AppText
              variant="callout"
              tone="secondary"
              numberOfLines={3}
              style={styles.body}
            >
              {content}
            </AppText>

            {rationale ? (
              <View style={styles.section}>
                <AppText variant="overline" tone="tertiary">
                  Rationale
                </AppText>
                <AppText variant="callout" tone="secondary">
                  {rationale}
                </AppText>
              </View>
            ) : null}
          </AppCard>
        </Animated.View>
      );
    },
    [colors.surfaceSunken, colors.textSecondary],
  );

  return (
    <SafeScreen>
      <NavBar
        title="Review history"
        rightSlot={
          rows.length > 0 ? (
            <AppChip tone="neutral">{String(rows.length)}</AppChip>
          ) : undefined
        }
      />

      <View
        style={[styles.segment, { backgroundColor: colors.surfaceSunken }]}
      >
        <SegmentButton label="Create" onPress={onGoToCreate} />
        <SegmentButton label="Review" onPress={onGoToReview} />
        <SegmentButton label="History" active onPress={() => {}} />
      </View>

      <AppInput
        value={organizerCode}
        onChangeText={setOrganizerCode}
        placeholder="Organizer code"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        hint="Decisions made by organizers (approve / override)."
      />

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: colors.dangerSoft }]}>
          <IconSymbol
            name="exclamationmark.triangle.fill"
            size={16}
            color={colors.danger}
          />
          <AppText variant="caption" style={{ color: colors.onDangerSoft }}>
            {error}
          </AppText>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.skeletons}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.list,
            rows.length === 0 ? styles.listEmpty : null,
          ]}
          refreshing={isLoading}
          onRefresh={loadHistory}
          ListEmptyComponent={
            canLoad ? (
              <EmptyState
                icon="clock.arrow.circlepath"
                title="No history yet"
                message="Approve or override a flagged submission and it will appear here."
                actionLabel="Refresh"
                onAction={loadHistory}
              />
            ) : (
              <EmptyState
                icon="lock.fill"
                title="Organizer code required"
                message="Enter your organizer code above to view past review decisions."
              />
            )
          }
        />
      )}
    </SafeScreen>
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
  segment: {
    flexDirection: 'row',
    gap: Spacing.xs,
    padding: Spacing.xs,
    borderRadius: Radius.pill,
    marginBottom: Spacing.base,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm + 1,
    borderRadius: Radius.pill,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.sm,
  },
  skeletons: {
    gap: Spacing.md,
    paddingTop: Spacing.base,
  },
  list: {
    gap: Spacing.md,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.xxl,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    flex: 1,
    gap: Spacing.xxs,
  },
  scoreBlock: {
    alignItems: 'flex-end',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  body: {
    marginTop: Spacing.md,
  },
  section: {
    gap: Spacing.xs,
    marginTop: Spacing.base,
  },
});
