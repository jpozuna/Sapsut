import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { SafeScreen, TAB_BAR_CLEARANCE } from '@/components/safe-screen';
import { ScreenState } from '@/components/screen-state';
import { AppCard, AppText, IconSymbol, ScreenHeader } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';
import { useRole } from '@/lib/role-context';
import { getSavedTeamId } from '@/lib/team-session';
import { useAppTheme } from '@/lib/ui';

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
  const { colors } = useAppTheme();
  const { role } = useRole();

  const [teams, setTeams] = useState<LeaderboardTeam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = await getSavedTeamId(
        role === 'organizer' ? 'organizer' : 'participant',
      );
      if (mounted) setMyTeamId(saved);
    })();
    return () => {
      mounted = false;
    };
  }, [role]);

  const fetchLeaderboard = useCallback(async () => {
    // Prevent overlapping requests (slow networks vs the 5s poll interval).
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await httpJson<LeaderboardResponse>(apiUrl('/leaderboard/'), {
        signal: ac.signal,
      });
      const list = Array.isArray(res?.teams) ? res.teams : [];
      // Only clear the error once the request actually succeeded, otherwise
      // polling can briefly mask a real failure as "missing data".
      setError(undefined);
      setTeams(list);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

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

      pollRef.current = setInterval(() => {
        fetchLeaderboard().catch(() => {
          // Keep prior data; first-load errors are handled by ScreenState.
        });
      }, 5000);

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

  const sorted = useMemo(
    () => [...teams].sort((a, b) => toScore(b) - toScore(a)),
    [teams],
  );

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

  const medalColor = (rank: number) =>
    rank === 1 ? colors.gold : rank === 2 ? colors.silver : colors.bronze;

  return (
    <ScreenState isLoading={isLoading} error={error} onRetry={onRetry}>
      <SafeScreen>
        <ScreenHeader
          title="Leaderboard"
          subtitle={
            sorted.length > 0
              ? `${sorted.length} ${sorted.length === 1 ? 'team' : 'teams'} competing`
              : 'Live team standings'
          }
          rightSlot={
            <View style={styles.liveRow}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <AppText variant="overline" tone="tertiary">
                Live
              </AppText>
            </View>
          }
        />

        <FlatList<LeaderboardTeam>
          data={sorted}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            sorted.length === 0 ? styles.listContentEmpty : null,
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
            const rank = index + 1;
            const isPodium = rank <= 3;
            const isMine = Boolean(myTeamId && item.id === myTeamId);

            return (
              <Animated.View
                entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(
                  260,
                )}
              >
                <AppCard
                  variant={isPodium ? 'elevated' : 'outlined'}
                  padded={false}
                  style={[
                    styles.row,
                    isMine
                      ? { borderWidth: 1.5, borderColor: colors.accent }
                      : null,
                  ]}
                >
                  <View
                    style={[
                      styles.rankBadge,
                      {
                        backgroundColor: isPodium
                          ? medalColor(rank)
                          : colors.surfaceSunken,
                      },
                    ]}
                  >
                    {isPodium ? (
                      <IconSymbol
                        name="trophy.fill"
                        size={15}
                        color={colors.onAccent}
                      />
                    ) : (
                      <AppText variant="label" tone="tertiary">
                        {String(rank)}
                      </AppText>
                    )}
                  </View>

                  <View style={styles.nameBlock}>
                    <AppText variant="title" numberOfLines={1}>
                      {item.name || 'Unnamed team'}
                    </AppText>
                    {isMine ? (
                      <AppText variant="caption" tone="accent">
                        Your team
                      </AppText>
                    ) : isPodium ? (
                      <AppText variant="caption" tone="tertiary">
                        {rank === 1
                          ? 'Leading'
                          : `${rank === 2 ? '2nd' : '3rd'} place`}
                      </AppText>
                    ) : null}
                  </View>

                  <View style={styles.scoreBlock}>
                    <AppText
                      variant="numeric"
                      style={{ color: isPodium ? colors.accent : colors.textPrimary }}
                    >
                      {String(toScore(item))}
                    </AppText>
                    <AppText variant="overline" tone="tertiary">
                      pts
                    </AppText>
                  </View>
                </AppCard>
              </Animated.View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="person.2.fill"
              title="No teams yet"
              message="Once teams join and start scoring, standings will appear here."
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
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: Radius.pill,
  },
  listContent: {
    gap: Spacing.sm,
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameBlock: {
    flex: 1,
    gap: 1,
  },
  scoreBlock: {
    alignItems: 'flex-end',
    gap: 0,
  },
});
