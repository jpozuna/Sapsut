import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { ScreenState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';

type Submission = {
  id: string;
  task_id?: string | null;
  team_id?: string | null;
  status?: string | null;
  score?: number | null;
  rationale?: string | null;
  confidence?: number | null;
  created_at?: string | null;
};

function normalizeStatus(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s || 'pending';
}

export default function SubmissionConfirmationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const submissionId = String(id ?? '').trim();

  const theme = useColorScheme() ?? 'light';
  const tint = Colors[theme].tint;
  const border = Colors[theme].icon;

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);

  const pollingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCount = useRef(0);
  const MAX_POLLS = 20; // ~30s at 1.5s intervals
  const mountedRef = useRef(true);

  const status = useMemo(
    () => normalizeStatus(submission?.status),
    [submission?.status],
  );

  const isTerminal = useMemo(() => status !== 'pending', [status]);
  const isUnderReview = useMemo(() => status === 'flagged', [status]);
  const isError = useMemo(() => status === 'error', [status]);
  const isAutoApproved = useMemo(
    () => status === 'auto_approved' || status === 'approved',
    [status],
  );

  const fetchOnce = useCallback(async () => {
    if (!submissionId) throw new Error('Missing submission id.');
    const data = await httpJson<Submission>(
      apiUrl(`/submissions/${submissionId}`),
    );
    return data;
  }, [submissionId]);

  const onRetry = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    pollCount.current = 0;
    try {
      const data = await fetchOnce();
      if (mountedRef.current) setSubmission(data);
    } catch (e) {
      if (mountedRef.current) setError(e);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [fetchOnce]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollingTimer.current) clearTimeout(pollingTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(undefined);
      pollCount.current = 0;
      try {
        const data = await fetchOnce();
        if (!cancelled && mountedRef.current) setSubmission(data);
      } catch (e) {
        if (!cancelled && mountedRef.current) setError(e);
      } finally {
        if (!cancelled && mountedRef.current) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchOnce]);

  useEffect(() => {
    if (!submissionId) return;
    if (isLoading) return;
    if (error) return;
    if (isTerminal) return;

    const poll = async () => {
      try {
        const data = await fetchOnce();
        if (mountedRef.current) setSubmission(data);
      } catch (e) {
        if (mountedRef.current) setError(e);
      }
    };

    if (pollCount.current >= MAX_POLLS) {
      setError(
        new Error(
          'Scoring is taking longer than expected. Check back in a moment.',
        ),
      );
      return;
    }
    pollCount.current += 1;
    pollingTimer.current = setTimeout(poll, 1500);
    return () => {
      if (pollingTimer.current) clearTimeout(pollingTimer.current);
    };
  }, [error, fetchOnce, isLoading, isTerminal, submissionId]);

  const onBackToTasks = useCallback(() => {
    router.replace('/(tabs)');
  }, []);

  const title = useMemo(() => {
    if (status === 'pending') return 'Submission received';
    if (isError) return 'Submission error';
    if (isUnderReview) return 'Under review';
    if (isAutoApproved) return 'Auto-approved';
    if (status === 'reviewed') return 'Reviewed';
    return 'Submission complete';
  }, [isAutoApproved, isError, isUnderReview, status]);

  return (
    <>
      <Stack.Screen options={{ title: 'Confirmation' }} />
      <ScreenState
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        loadingLabel="Checking submission status…"
      >
        <ThemedView style={styles.container}>
          <View style={styles.content}>
            <ThemedText type="title">{title}</ThemedText>

            <ThemedText style={styles.hint}>
              Submission ID:{' '}
              <ThemedText type="defaultSemiBold">{submissionId}</ThemedText>
            </ThemedText>

            {status === 'pending' ? (
              <ThemedText style={styles.hint}>
                Status:{' '}
                <ThemedText type="defaultSemiBold">processing…</ThemedText>
              </ThemedText>
            ) : null}

            {isUnderReview ? (
              <ThemedText style={styles.hint}>
                Your submission was flagged and is{' '}
                <ThemedText type="defaultSemiBold">under review</ThemedText>.
              </ThemedText>
            ) : null}

            {isError ? (
              <ThemedText style={[styles.hint, { color: tint }]}>
                We hit an error processing your submission
                {submission?.rationale?.trim()
                  ? `: ${submission.rationale.trim()}`
                  : '.'}
              </ThemedText>
            ) : null}

            {isAutoApproved && submission?.score != null ? (
              <View style={styles.resultBox}>
                <ThemedText style={styles.hint}>
                  Score:{' '}
                  <ThemedText type="defaultSemiBold">
                    {String(submission.score)}
                  </ThemedText>
                </ThemedText>
                {submission?.rationale?.trim() ? (
                  <ThemedText style={styles.hint}>
                    Rationale:{' '}
                    <ThemedText type="defaultSemiBold">
                      {submission.rationale.trim()}
                    </ThemedText>
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            {isTerminal ? (
              <Pressable
                onPress={onBackToTasks}
                style={({ pressed }) => [
                  styles.button,
                  { borderColor: tint, backgroundColor: 'transparent' },
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                  Back to tasks
                </ThemedText>
              </Pressable>
            ) : (
              <ThemedText style={[styles.hint, { opacity: 0.7 }]}>
                We’ll update this screen automatically.
              </ThemedText>
            )}

            {!submissionId ? (
              <ThemedText style={[styles.hint, { color: tint }]}>
                Missing submission id.
              </ThemedText>
            ) : null}

            <View
              style={[
                styles.statusPill,
                { borderColor: border, backgroundColor: 'transparent' },
              ]}
            >
              <ThemedText style={styles.pillText}>
                Status: <ThemedText type="defaultSemiBold">{status}</ThemedText>
              </ThemedText>
            </View>
          </View>
        </ThemedView>
      </ScreenState>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  content: {
    gap: 10,
  },
  hint: {
    opacity: 0.9,
  },
  resultBox: {
    gap: 8,
    paddingTop: 6,
  },
  button: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  statusPill: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  pillText: {
    opacity: 0.85,
  },
});
