import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { SafeScreen, TAB_BAR_CLEARANCE } from '@/components/safe-screen';
import { ScreenState } from '@/components/screen-state';
import { SapsutLogo } from '@/components/sapsut-logo';
import {
  AppCard,
  AppChip,
  AppText,
  IconSymbol,
  ScreenHeader,
} from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Radius, Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';
import { useRole } from '@/lib/role-context';
import { getSavedTeamId } from '@/lib/team-session';
import { useAppTheme } from '@/lib/ui';

type Task = {
  id: string | number;
  title: string;
  description: string | null;
  type: 'text' | 'photo' | 'combo';
  max_points: number;
  is_active?: boolean | null;
  opens_at?: string | null;
  closes_at?: string | null;
};

type SubmissionListItem = {
  id: string;
  task_id?: string | null;
  team_id?: string | null;
  status?: string | null;
};

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeStatus(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s || 'pending';
}

function isTaskOpenNow(task: Task, nowMs: number): boolean {
  const opensMs = task.opens_at ? Date.parse(task.opens_at) : NaN;
  const closesMs = task.closes_at ? Date.parse(task.closes_at) : NaN;
  const afterOpen = Number.isFinite(opensMs) ? nowMs >= opensMs : true;
  const beforeClose = Number.isFinite(closesMs) ? nowMs <= closesMs : true;
  return afterOpen && beforeClose;
}

function typeMeta(type: Task['type']): { label: string; icon: IconSymbolName } {
  switch (type) {
    case 'text':
      return { label: 'Text', icon: 'text.alignleft' };
    case 'photo':
      return { label: 'Photo', icon: 'camera.fill' };
    case 'combo':
      return { label: 'Text + Photo', icon: 'photo.on.rectangle' };
    default:
      return { label: String(type), icon: 'doc.text.fill' };
  }
}

export default function TaskListScreen() {
  const { colors } = useAppTheme();
  const { role } = useRole();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [taskSubmissionByTaskId, setTaskSubmissionByTaskId] = useState<
    Record<string, { id: string; status: string }>
  >({});

  const fetchTasks = useCallback(async () => {
    setError(undefined);
    const data = await httpJson<Task[]>(apiUrl('/tasks/'));
    setTasks(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await fetchTasks();
      } catch (e) {
        if (mounted) setError(e);
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fetchTasks]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = await getSavedTeamId(
        role === 'organizer' ? 'organizer' : 'participant',
      );
      if (!mounted) return;
      setTeamId(saved);
    })();
    return () => {
      mounted = false;
    };
  }, [role]);

  useEffect(() => {
    if (role === 'organizer') {
      setTaskSubmissionByTaskId({});
      return;
    }
    if (!teamId?.trim()) {
      setTaskSubmissionByTaskId({});
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const list = await httpJson<SubmissionListItem[]>(
          apiUrl(`/submissions/?team_id=${encodeURIComponent(teamId.trim())}`),
        );
        const next: Record<string, { id: string; status: string }> = {};
        for (const s of Array.isArray(list) ? list : []) {
          const tid = typeof s?.task_id === 'string' ? s.task_id.trim() : '';
          if (!tid) continue;
          // The backend returns newest-first; keep the first (latest) per task.
          if (next[tid]) continue;
          next[tid] = { id: String(s.id), status: normalizeStatus(s.status) };
        }
        if (mounted) setTaskSubmissionByTaskId(next);
      } catch {
        if (mounted) setTaskSubmissionByTaskId({});
      }
    })();
    return () => {
      mounted = false;
    };
  }, [role, teamId]);

  const onRetry = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchTasks();
    } catch (e) {
      setError(e);
    } finally {
      setIsLoading(false);
    }
  }, [fetchTasks]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchTasks();
    } catch (e) {
      setError(e);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchTasks]);

  const activeTasks = useMemo(() => {
    const nowMs = Date.now();
    return tasks.filter(
      (t) => (t.is_active ?? true) && isTaskOpenNow(t, nowMs),
    );
  }, [tasks]);

  const completedCount = useMemo(() => {
    return activeTasks.reduce((acc, t) => {
      const status = taskSubmissionByTaskId[String(t.id)]?.status;
      const done =
        status === 'auto_approved' ||
        status === 'approved' ||
        status === 'reviewed';
      return acc + (done ? 1 : 0);
    }, 0);
  }, [activeTasks, taskSubmissionByTaskId]);

  const earnedPoints = useMemo(() => {
    return activeTasks.reduce((acc, t) => {
      const status = taskSubmissionByTaskId[String(t.id)]?.status;
      const done =
        status === 'auto_approved' ||
        status === 'approved' ||
        status === 'reviewed';
      return acc + (done ? Number(t.max_points) || 0 : 0);
    }, 0);
  }, [activeTasks, taskSubmissionByTaskId]);

  const total = activeTasks.length;
  const progress = total > 0 ? completedCount / total : 0;
  const isParticipant = role !== 'organizer';

  const subtitle =
    total === 0
      ? 'No tasks are open right now.'
      : isParticipant
        ? `${total - completedCount} open · ${completedCount} completed`
        : `${total} active ${total === 1 ? 'task' : 'tasks'} · tap to edit`;

  return (
    <ScreenState isLoading={isLoading} error={error} onRetry={onRetry}>
      <SafeScreen>
        <ScreenHeader
          title="Tasks"
          subtitle={subtitle}
          topSlot={
            <>
              <SapsutLogo width={104} height={46} />
              {isParticipant && earnedPoints > 0 ? (
                <View
                  style={[
                    styles.scorePill,
                    { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <IconSymbol
                    name="star.fill"
                    size={13}
                    color={colors.accent}
                  />
                  <AppText
                    variant="label"
                    style={{ color: colors.accentOnSoft }}
                  >
                    {`${earnedPoints} pts`}
                  </AppText>
                </View>
              ) : null}
            </>
          }
        />

        {isParticipant && total > 0 ? (
          <View
            style={[styles.track, { backgroundColor: colors.surfaceSunken }]}
          >
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: colors.accent,
                  width: `${Math.round(progress * 100)}%`,
                },
              ]}
            />
          </View>
        ) : null}

        <FlatList
          data={activeTasks}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            activeTasks.length === 0 ? styles.listContentEmpty : null,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          renderItem={({ item, index }) => {
            const nowMs = Date.now();
            const opensMs = item.opens_at ? Date.parse(item.opens_at) : NaN;
            const isNew =
              Number.isFinite(opensMs) &&
              opensMs <= nowMs &&
              nowMs - opensMs <= NEW_WINDOW_MS;

            const submission = taskSubmissionByTaskId[String(item.id)];
            const status = submission?.status ?? null;
            const isInReview = status === 'flagged';
            const isCompleted =
              status === 'auto_approved' ||
              status === 'approved' ||
              status === 'reviewed';
            const isSubmittedButNotComplete =
              Boolean(submission) && !isCompleted;
            const isDisabled = isCompleted;

            const meta = typeMeta(item.type);

            const onPress = isDisabled
              ? undefined
              : role === 'organizer'
                ? () =>
                    router.push({
                      pathname: '/organizer/create-task',
                      params: { taskId: String(item.id) },
                    })
                : isSubmittedButNotComplete
                  ? () =>
                      router.push({
                        pathname: '/submissions/[id]',
                        params: { id: submission?.id ?? '' },
                      })
                  : () =>
                      router.push({
                        pathname: '/tasks/[id]/submit',
                        params: { id: String(item.id) },
                      });

            return (
              <Animated.View
                entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(
                  280,
                )}
              >
                <AppCard onPress={onPress} disabled={isDisabled}>
                  <View style={styles.cardHeader}>
                    <View style={styles.titleBlock}>
                      <AppText variant="title" numberOfLines={2}>
                        {item.title}
                      </AppText>
                    </View>
                    <View
                      style={[
                        styles.points,
                        { backgroundColor: colors.surfaceSunken },
                      ]}
                    >
                      <AppText variant="numeric" style={styles.pointsValue}>
                        {String(item.max_points)}
                      </AppText>
                      <AppText variant="overline" tone="tertiary">
                        pts
                      </AppText>
                    </View>
                  </View>

                  {item.description?.trim() ? (
                    <AppText
                      variant="callout"
                      tone="secondary"
                      numberOfLines={2}
                      style={styles.description}
                    >
                      {item.description}
                    </AppText>
                  ) : null}

                  <View style={styles.footer}>
                    <View style={styles.metaRow}>
                      <IconSymbol
                        name={meta.icon}
                        size={14}
                        color={colors.textTertiary}
                      />
                      <AppText variant="caption" tone="tertiary">
                        {meta.label}
                      </AppText>
                    </View>

                    <View style={styles.chipRow}>
                      {role === 'organizer' ? (
                        <AppChip tone="brick">Edit only</AppChip>
                      ) : null}
                      {isCompleted ? (
                        <AppChip tone="success">Completed</AppChip>
                      ) : isInReview ? (
                        <AppChip tone="warning">In review</AppChip>
                      ) : isSubmittedButNotComplete ? (
                        <AppChip tone="accent">Submitted</AppChip>
                      ) : isNew ? (
                        <AppChip tone="accent" solid>
                          New
                        </AppChip>
                      ) : null}
                    </View>
                  </View>
                </AppCard>
              </Animated.View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="flag.fill"
              title="No tasks yet"
              message="Check back once organizers open the next round of hunt tasks."
              actionLabel="Refresh"
              onAction={onRetry}
            />
          }
        />
      </SafeScreen>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.pill,
  },
  track: {
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    marginBottom: Spacing.base,
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  listContent: {
    gap: Spacing.md,
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  titleBlock: {
    flex: 1,
    paddingTop: Spacing.xxs,
  },
  points: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 54,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm - 2,
    borderRadius: Radius.sm,
  },
  pointsValue: {
    fontSize: 18,
    lineHeight: 22,
  },
  description: {
    marginTop: Spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginTop: Spacing.base,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
