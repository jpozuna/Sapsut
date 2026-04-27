import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenState } from '@/components/screen-state';
import { AppButton, AppCard } from '@/components/ui';
import { screenStyles, textStyles, useAppTheme } from '@/lib/ui';
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
  const { textColor, backgroundColor, tint } = useAppTheme();
  const insets = useSafeAreaInsets();

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
      <View style={[screenStyles.container, { backgroundColor }]}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
          <Text style={[textStyles.title, { color: textColor }]}>
            Leaderboard
          </Text>
          <Text
            style={[textStyles.default, styles.subtitle, { color: textColor }]}
          >
            Live team standings (updates automatically).
          </Text>
        </View>

        <FlatList<LeaderboardTeam>
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            sorted.length === 0 ? styles.listContentEmpty : null,
          ]}
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          renderItem={({ item, index }) => {
            return (
              <AppCard style={styles.row} contentStyle={styles.rowContent}>
                <View style={styles.rowLeft}>
                  <Text
                    style={[
                      textStyles.defaultSemiBold,
                      styles.rank,
                      { color: textColor },
                    ]}
                  >
                    {index + 1}
                  </Text>
                  <Text
                    style={[
                      textStyles.subtitle,
                      styles.teamName,
                      { color: textColor },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name || 'Unnamed team'}
                  </Text>
                </View>

                <Text
                  style={[
                    textStyles.defaultSemiBold,
                    styles.score,
                    { color: tint },
                  ]}
                >
                  {toScore(item)}
                </Text>
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
                No teams yet
              </Text>
              <Text
                style={[
                  textStyles.default,
                  styles.emptyMessage,
                  { color: textColor },
                ]}
              >
                Once teams join and score points, they’ll show up here.
              </Text>
              <AppButton tone="secondary" onPress={onRetry} style={styles.retryButton}>
                Refresh
              </AppButton>
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
    borderRadius: 16,
    overflow: 'hidden',
  },
  rowContent: {
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
    marginTop: 4,
  },
});
