import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenState } from '@/components/screen-state';
import { SapsutLogo } from '@/components/sapsut-logo';
import { AppCard, AppChip } from '@/components/ui';
import { screenStyles, textStyles, useAppTheme } from '@/lib/ui';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';
import { getSavedTeamId } from '@/lib/team-session';

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

function formatSubmissionType(type: Task['type']): string {
  switch (type) {
    case 'text':
      return 'Text';
    case 'photo':
      return 'Photo';
    case 'combo':
      return 'Text + Photo';
    default:
      return String(type);
  }
}

function submissionTone(type: Task['type']): 'default' | 'accent' {
  return type === 'photo' || type === 'combo' ? 'accent' : 'default';
}

export default function TaskListScreen() {
  const { textColor, backgroundColor } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [taskSubmissionByTaskId, setTaskSubmissionByTaskId] = useState<
    Record<string, { id: string; status: string }>
  >({});

  const fetchTasks = useCallback(async () => {
    // Note: This does not cancel in-flight requests on unmount. For production,
    // we should add an AbortController pattern to prevent state updates after unmount.
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
      const saved = await getSavedTeamId();
      if (!mounted) return;
      setTeamId(saved);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
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
          // The backend returns newest-first; keep the first (latest) submission per task.
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
  }, [teamId]);

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

  return (
    <ScreenState
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      loadingLabel="Loading tasks…"
    >
      <View style={[screenStyles.container, { backgroundColor }]}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
          <View style={styles.headerTopRow}>
            <SapsutLogo width={120} height={54} />
          </View>
          <Text style={[textStyles.title, { color: textColor }]}>Tasks</Text>
          <Text
            style={[textStyles.default, styles.subtitle, { color: textColor }]}
          >
            Pick a task to submit your entry.
          </Text>
        </View>

        <FlatList
          data={activeTasks}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.listContent,
            activeTasks.length === 0 ? styles.listContentEmpty : null,
          ]}
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          renderItem={({ item }) => {
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
            const isSubmittedButNotComplete = Boolean(submission) && !isCompleted;
            const isDisabled = isCompleted;

            return (
              <AppCard
                onPress={
                  isDisabled
                    ? undefined
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
                          })
                }
                disabled={isDisabled}
                style={[styles.card, isDisabled ? styles.cardDisabled : null]}
                contentStyle={styles.cardContent}
              >
                <View style={styles.cardHeader}>
                  <Text
                    style={[
                      textStyles.subtitle,
                      styles.cardTitle,
                      { color: textColor, opacity: isDisabled ? 0.45 : 1 },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <View style={styles.chipRow}>
                    {isCompleted ? (
                      <AppChip tone="accent" selected>
                        Completed
                      </AppChip>
                    ) : isInReview ? (
                      <AppChip tone="danger">In review</AppChip>
                    ) : isNew ? (
                      <AppChip>New</AppChip>
                    ) : null}
                    <AppChip tone="accent">{item.max_points} pts</AppChip>
                  </View>
                </View>

                {item.description?.trim() ? (
                  <Text
                    style={[
                      textStyles.default,
                      styles.description,
                      { color: textColor, opacity: isDisabled ? 0.45 : 0.9 },
                    ]}
                  >
                    {item.description}
                  </Text>
                ) : null}

                <View style={styles.submissionRow}>
                  <AppChip tone={submissionTone(item.type)}>
                    {formatSubmissionType(item.type)}
                  </AppChip>
                </View>
              </AppCard>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text
                style={[
                  textStyles.subtitle,
                  styles.emptyTitle,
                  { color: textColor },
                ]}
              >
                No tasks available
              </Text>
              <Text
                style={[
                  textStyles.default,
                  styles.emptyMessage,
                  { color: textColor },
                ]}
              >
                Check back later for new hunt tasks.
              </Text>
            </View>
          }
        />
      </View>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 6,
    paddingBottom: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  subtitle: {
    opacity: 0.8,
  },
  listContent: {
    gap: 12,
    paddingVertical: 8,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 16,
  },
  cardDisabled: {
    opacity: 0.65,
  },
  cardContent: {
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  description: {
    opacity: 0.9,
  },
  submissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
    opacity: 0.85,
  },
});
