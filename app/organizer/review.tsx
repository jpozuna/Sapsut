import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { SafeScreen } from '@/components/safe-screen';
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
import type { AppChipTone } from '@/components/ui';
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

type ReviewQueueRow = {
  id: string;
  submission_id: string;
  claude_score: number | null;
  confidence: number | null;
  claude_rationale: string | null;
  created_at: string | null;
  submission?: Submission | null;
};

/** Confidence can arrive as a 0–1 ratio or a 0–100 percentage. */
function toConfidencePercent(raw: number | null | undefined): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function confidenceTone(pct: number): AppChipTone {
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'warning';
  return 'danger';
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

export default function OrganizerReviewDashboard() {
  const { colors } = useAppTheme();
  const goToCreate = useCallback(() => {
    // keep organizer code in session via RoleContext
    // navigation only; API calls still require entering/using the code field
    // (organizer code is prefilled on arrival)
    router.push('/(tabs)/organizer');
  }, []);
  const goToHistory = useCallback(() => {
    router.push('/(tabs)/organizer/history');
  }, []);

  const {
    role,
    organizerCode: sessionOrganizerCode,
    setOrganizerCode: setSessionOrganizerCode,
    setRole,
  } = useRole();

  const [organizerCode, setOrganizerCode] = useState('');
  const [rows, setRows] = useState<ReviewQueueRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideScores, setOverrideScores] = useState<Record<string, string>>(
    {},
  );
  const [busyById, setBusyById] = useState<Record<string, boolean>>({});

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
    // Keep session state in sync while typing (session-only; not persisted).
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

  const loadQueue = useCallback(async () => {
    if (!organizerCode.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await organizerJson<ReviewQueueRow[]>(
        '/organizer/review-queue',
        organizerCode,
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(toAppError(e).message ?? 'Failed to load review queue.');
    } finally {
      setIsLoading(false);
    }
  }, [organizerCode]);

  useEffect(() => {
    // Don’t auto-fire without the code; wait for user input.
    setRows([]);
    setError(null);
  }, [organizerCode]);

  useEffect(() => {
    // Smooth UX: if we arrive with a session code, auto-load once.
    if (!didAutoLoadRef.current && canLoad) {
      didAutoLoadRef.current = true;
      loadQueue().catch(() => {
        // Screen shows error state already.
      });
    }
  }, [canLoad, loadQueue]);

  const setBusy = useCallback((id: string, v: boolean) => {
    setBusyById((prev) => ({ ...prev, [id]: v }));
  }, []);

  const onApprove = useCallback(
    async (row: ReviewQueueRow) => {
      if (!organizerCode.trim()) return;
      setBusy(row.id, true);
      setError(null);
      try {
        await organizerJson(
          `/organizer/review-queue/${row.id}/approve`,
          organizerCode,
          { method: 'POST' },
        );
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } catch (e) {
        setError(toAppError(e).message ?? 'Approve failed. Please try again.');
      } finally {
        setBusy(row.id, false);
      }
    },
    [organizerCode, setBusy],
  );

  const onOverride = useCallback(
    async (row: ReviewQueueRow) => {
      if (!organizerCode.trim()) return;
      const raw = (overrideScores[row.id] ?? '').trim();
      const score = Number(raw);
      if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0) {
        setError('Enter a valid non-negative whole number to override.');
        return;
      }

      setBusy(row.id, true);
      setError(null);
      try {
        await organizerJson(
          `/organizer/review-queue/${row.id}/override`,
          organizerCode,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ score }),
          },
        );
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } catch (e) {
        setError(toAppError(e).message ?? 'Override failed. Please try again.');
      } finally {
        setBusy(row.id, false);
      }
    },
    [organizerCode, overrideScores, setBusy],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ReviewQueueRow; index: number }) => {
      const s = item.submission ?? null;
      const content =
        (s?.gpt4o_description ?? '').trim() ||
        (s?.text_answer ?? '').trim() ||
        '(No submission content)';

      const busy = Boolean(busyById[item.id]);
      const suggested = item.claude_score;

      const confidence = toConfidencePercent(item.confidence ?? s?.confidence);
      const photo = (s?.photo_url ?? '').trim();
      const team = (s?.team_id ?? '').trim();
      const task = (s?.task_id ?? '').trim();
      const when = formatWhen(item.created_at ?? s?.created_at);
      const rationale = (item.claude_rationale ?? '').trim();

      return (
        <Animated.View
          entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(280)}
        >
          <AppCard>
            <View style={styles.cardHeader}>
              <View style={styles.identity}>
                <AppText variant="title" numberOfLines={1}>
                  {team ? `Team ${team}` : 'Unknown team'}
                </AppText>
                <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                  {task ? `Task ${task}` : `Queue ${item.id}`}
                </AppText>
              </View>

              <View
                style={[
                  styles.scoreBadge,
                  { backgroundColor: colors.surfaceSunken },
                ]}
              >
                <AppText variant="numeric" style={styles.scoreValue}>
                  {suggested === null || suggested === undefined
                    ? '—'
                    : String(suggested)}
                </AppText>
                <AppText variant="overline" tone="tertiary">
                  AI pts
                </AppText>
              </View>
            </View>

            <View style={styles.chipRow}>
              {confidence !== null ? (
                <AppChip tone={confidenceTone(confidence)}>
                  {`${confidence}% confidence`}
                </AppChip>
              ) : (
                <AppChip tone="neutral">Confidence unknown</AppChip>
              )}
              {when ? <AppChip tone="neutral">{when}</AppChip> : null}
            </View>

            {photo ? (
              <Image
                source={{ uri: photo }}
                style={[
                  styles.photo,
                  { backgroundColor: colors.surfaceSunken },
                ]}
                contentFit="cover"
                transition={180}
              />
            ) : null}

            <View style={styles.section}>
              <AppText variant="overline" tone="tertiary">
                Submission
              </AppText>
              <AppText variant="callout" tone="secondary">
                {content}
              </AppText>
            </View>

            <View style={styles.section}>
              <AppText variant="overline" tone="tertiary">
                AI rationale
              </AppText>
              <AppText variant="callout" tone="secondary">
                {rationale || '—'}
              </AppText>
            </View>

            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />

            <AppButton
              tone="primary"
              fullWidth
              loading={busy}
              disabled={busy || suggested === null || suggested === undefined}
              onPress={() => onApprove(item)}
              icon={
                <IconSymbol
                  name="checkmark.circle.fill"
                  size={17}
                  color={colors.onAccent}
                />
              }
            >
              {suggested === null || suggested === undefined
                ? 'Approve'
                : `Approve ${suggested} pts`}
            </AppButton>

            <View style={styles.overrideRow}>
              <AppInput
                value={overrideScores[item.id] ?? ''}
                onChangeText={(t) =>
                  setOverrideScores((prev) => ({ ...prev, [item.id]: t }))
                }
                placeholder="Score"
                keyboardType="number-pad"
                editable={!busy}
                containerStyle={styles.overrideInput}
              />
              <AppButton
                tone="secondary"
                disabled={busy}
                onPress={() => onOverride(item)}
              >
                Override
              </AppButton>
            </View>
          </AppCard>
        </Animated.View>
      );
    },
    [
      busyById,
      colors.border,
      colors.onAccent,
      colors.surfaceSunken,
      onApprove,
      onOverride,
      overrideScores,
    ],
  );

  return (
    <SafeScreen>
      <NavBar
        title="Review queue"
        rightSlot={
          rows.length > 0 ? (
            <AppChip tone="accent" solid>
              {String(rows.length)}
            </AppChip>
          ) : undefined
        }
      />

      <View style={[styles.segment, { backgroundColor: colors.surfaceSunken }]}>
        <SegmentButton label="Create" onPress={goToCreate} />
        <SegmentButton label="Review" active onPress={() => {}} />
        <SegmentButton label="History" onPress={goToHistory} />
      </View>

      <View style={styles.codeRow}>
        <AppInput
          value={organizerCode}
          onChangeText={setOrganizerCode}
          placeholder="Organizer code"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          containerStyle={styles.codeInput}
        />
        <AppButton
          tone="primary"
          onPress={loadQueue}
          disabled={!canLoad || isLoading}
          loading={isLoading}
        >
          Load
        </AppButton>
      </View>

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
          onRefresh={loadQueue}
          ListEmptyComponent={
            canLoad ? (
              <EmptyState
                icon="checkmark.seal.fill"
                title="Queue clear"
                message="No flagged submissions right now. Pull to refresh when new ones land."
                actionLabel="Refresh"
                onAction={loadQueue}
              />
            ) : (
              <EmptyState
                icon="lock.fill"
                title="Organizer code required"
                message="Enter your organizer code above to load flagged submissions."
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
  codeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  codeInput: {
    flex: 1,
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
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  identity: {
    flex: 1,
    gap: Spacing.xxs,
  },
  scoreBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 62,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm - 2,
    borderRadius: Radius.sm,
  },
  scoreValue: {
    fontSize: 18,
    lineHeight: 22,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: Radius.md,
    marginTop: Spacing.md,
  },
  section: {
    gap: Spacing.xs,
    marginTop: Spacing.base,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.base,
  },
  overrideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  overrideInput: {
    flex: 1,
  },
});
