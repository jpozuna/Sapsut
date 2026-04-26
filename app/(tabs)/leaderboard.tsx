import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { ScreenState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';

type LeaderboardTeam = {
  id: string;
  name: string;
  total_score?: number | null;
};

type LeaderboardResponse = {
  teams: LeaderboardTeam[];
};

function toScore(team: LeaderboardTeam): number {
  const n = Number(team.total_score ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export default function LeaderboardScreen() {
  const theme = useColorScheme() ?? 'light';
  const tint = Colors[theme].tint;
  const border = Colors[theme].icon;

  const [teams, setTeams] = useState<LeaderboardTeam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    // Prevent overlapping requests (e.g., slow networks vs 5s polling interval).
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // Cancel any previous request (e.g., if user blurs/focuses quickly).
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await httpJson<LeaderboardResponse>(apiUrl('/leaderboard/'), {
        signal: ac.signal,
      });
      const list = Array.isArray(res?.teams) ? res.teams : [];
      // Only clear an error once we know the request succeeded. Otherwise polling can
      // briefly hide a real error and make the UI look like "missing data".
      setError(undefined);
      setTeams(list);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      // Initial (or re-focus) load.
      (async () => {
        setError(undefined);
        setIsLoading(true);
        try {
          await fetchLeaderboard();
        } catch (e) {
          if (mounted) setError(e);
        } finally {
          if (mounted) setIsLoading(false);
        }
      })();

      // Poll only while this tab is focused.
      const intervalMs = 5000;
      pollRef.current = setInterval(() => {
        fetchLeaderboard().catch(() => {
          // Keep previous data; error UI is handled by the explicit screen state on first load / retries.
        });
      }, intervalMs);

      return () => {
        mounted = false;
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = null;
        inFlightRef.current = false;
      };
    }, [fetchLeaderboard]),
  );

  const sorted = useMemo(() => {
    return [...teams].sort((a, b) => toScore(b) - toScore(a));
  }, [teams]);

  const onRetry = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchLeaderboard();
    } catch (e) {
      setError(e);
    } finally {
      setIsLoading(false);
    }
  }, [fetchLeaderboard]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchLeaderboard();
    } catch (e) {
      setError(e);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchLeaderboard]);

  return (
    <ScreenState
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      loadingLabel="Loading leaderboard…"
    >
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">Leaderboard</ThemedText>
          <ThemedText style={styles.subtitle}>
            Live team standings (updates automatically).
          </ThemedText>
        </View>

        <FlatList
          data={sorted}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.listContent,
            sorted.length === 0 ? styles.listContentEmpty : null,
          ]}
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          renderItem={({ item, index }) => {
            return (
              <View style={[styles.row, { borderColor: border }]}>
                <View style={styles.rowLeft}>
                  <ThemedText type="defaultSemiBold" style={styles.rank}>
                    {index + 1}
                  </ThemedText>
                  <ThemedText type="subtitle" style={styles.teamName}>
                    {item.name || 'Unnamed team'}
                  </ThemedText>
                </View>

                <ThemedText
                  type="defaultSemiBold"
                  style={[styles.score, { color: tint }]}
                >
                  {toScore(item)}
                </ThemedText>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText type="subtitle" style={styles.emptyTitle}>
                No teams yet
              </ThemedText>
              <ThemedText style={styles.emptyMessage}>
                Once teams join and score points, they’ll show up here.
              </ThemedText>
              <Pressable
                onPress={onRetry}
                style={({ pressed }) => [
                  styles.retryButton,
                  { borderColor: tint },
                  pressed ? styles.retryButtonPressed : null,
                ]}
              >
                <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                  Refresh
                </ThemedText>
              </Pressable>
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
  subtitle: {
    opacity: 0.8,
  },
  listContent: {
    gap: 10,
    paddingVertical: 8,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  rank: {
    width: 28,
    textAlign: 'center',
    opacity: 0.85,
  },
  teamName: {
    flex: 1,
  },
  score: {
    fontSize: 16,
  },
  empty: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
    opacity: 0.85,
  },
  retryButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  retryButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
