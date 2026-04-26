import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ScreenState } from '@/components/screen-state';
import { SapsutLogo } from '@/components/sapsut-logo';
import { screenStyles, textStyles, useAppTheme } from '@/lib/ui';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';

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

export default function TaskListScreen() {
  const { textColor, backgroundColor, border, tint } = useAppTheme();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

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
        <View style={styles.header}>
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
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/tasks/[id]/submit',
                    params: { id: String(item.id) },
                  })
                }
                style={({ pressed }) => [
                  styles.card,
                  { borderColor: border },
                  pressed ? styles.cardPressed : null,
                ]}
              >
                <View style={styles.cardHeader}>
                  <Text
                    style={[
                      textStyles.subtitle,
                      styles.cardTitle,
                      { color: textColor },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <View style={[styles.pill, { borderColor: tint }]}>
                    <Text
                      style={[
                        textStyles.defaultSemiBold,
                        styles.pillText,
                        { color: tint },
                      ]}
                    >
                      {item.max_points} pts
                    </Text>
                  </View>
                </View>

                {item.description?.trim() ? (
                  <Text
                    style={[
                      textStyles.default,
                      styles.description,
                      { color: textColor },
                    ]}
                  >
                    {item.description}
                  </Text>
                ) : null}

                <View style={styles.metaRow}>
                  <Text
                    style={[
                      textStyles.defaultSemiBold,
                      styles.metaLabel,
                      { color: textColor },
                    ]}
                  >
                    Submission:
                  </Text>
                  <Text
                    style={[
                      textStyles.default,
                      styles.metaValue,
                      { color: textColor },
                    ]}
                  >
                    {formatSubmissionType(item.type)}
                  </Text>
                </View>
              </Pressable>
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
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
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
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillText: {
    fontSize: 13,
  },
  description: {
    opacity: 0.9,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  metaLabel: {
    opacity: 0.85,
  },
  metaValue: {
    opacity: 0.85,
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
