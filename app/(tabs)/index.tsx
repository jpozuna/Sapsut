import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { ScreenState } from '@/components/screen-state';
import { SapsutLogo } from '@/components/sapsut-logo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
  const theme = useColorScheme() ?? 'light';
  const border = Colors[theme].icon;
  const tint = Colors[theme].tint;

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
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <SapsutLogo width={120} height={54} />
          </View>
          <ThemedText type="title">Tasks</ThemedText>
          <ThemedText style={styles.subtitle}>
            Pick a task to submit your entry.
          </ThemedText>
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
                  <ThemedText type="subtitle" style={styles.cardTitle}>
                    {item.title}
                  </ThemedText>
                  <ThemedView
                    style={[styles.pill, { borderColor: tint }]}
                    lightColor="transparent"
                    darkColor="transparent"
                  >
                    <ThemedText
                      type="defaultSemiBold"
                      style={[styles.pillText, { color: tint }]}
                    >
                      {item.max_points} pts
                    </ThemedText>
                  </ThemedView>
                </View>

                {item.description?.trim() ? (
                  <ThemedText style={styles.description}>
                    {item.description}
                  </ThemedText>
                ) : null}

                <View style={styles.metaRow}>
                  <ThemedText type="defaultSemiBold" style={styles.metaLabel}>
                    Submission:
                  </ThemedText>
                  <ThemedText style={styles.metaValue}>
                    {formatSubmissionType(item.type)}
                  </ThemedText>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText type="subtitle" style={styles.emptyTitle}>
                No tasks available
              </ThemedText>
              <ThemedText style={styles.emptyMessage}>
                Check back later for new hunt tasks.
              </ThemedText>
            </View>
          }
        />
      </ThemedView>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
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
