import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { ScreenState } from '@/components/screen-state';
import { SafeScreen } from '@/components/safe-screen';
import { textStyles, useAppTheme } from '@/lib/ui';
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

  const { textColor, backgroundColor, tint, border } = useAppTheme();

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
    // Avoid routing to the group root (which can surface as a weird back label).
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
      <Stack.Screen
        options={{
          title: 'Confirmation',
          headerBackTitle: 'Tasks',
          headerLeft: () => (
            <Pressable onPress={onBackToTasks} style={styles.headerBack}>
              <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                Back
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScreenState
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        loadingLabel="Checking submission status…"
      >
        <SafeScreen backgroundColor={backgroundColor}>
          <View style={styles.content}>
            <Text style={[textStyles.title, { color: textColor }]}>
              {title}
            </Text>

            <Text
              style={[textStyles.default, styles.hint, { color: textColor }]}
            >
              Submission ID:{' '}
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                {submissionId}
              </Text>
            </Text>

            {status === 'pending' ? (
              <Text
                style={[textStyles.default, styles.hint, { color: textColor }]}
              >
                Status:{' '}
                <Text
                  style={[textStyles.defaultSemiBold, { color: textColor }]}
                >
                  processing…
                </Text>
              </Text>
            ) : null}

            {isUnderReview ? (
              <Text
                style={[textStyles.default, styles.hint, { color: textColor }]}
              >
                Your submission was flagged and is{' '}
                <Text
                  style={[textStyles.defaultSemiBold, { color: textColor }]}
                >
                  under review
                </Text>
                .
              </Text>
            ) : null}

            {isError ? (
              <Text style={[textStyles.default, styles.hint, { color: tint }]}>
                We hit an error processing your submission
                {submission?.rationale?.trim()
                  ? `: ${submission.rationale.trim()}`
                  : '.'}
              </Text>
            ) : null}

            {isAutoApproved && submission?.score != null ? (
              <View style={styles.resultBox}>
                <Text
                  style={[
                    textStyles.default,
                    styles.hint,
                    { color: textColor },
                  ]}
                >
                  Score:{' '}
                  <Text
                    style={[textStyles.defaultSemiBold, { color: textColor }]}
                  >
                    {String(submission.score)}
                  </Text>
                </Text>
                {submission?.rationale?.trim() ? (
                  <Text
                    style={[
                      textStyles.default,
                      styles.hint,
                      { color: textColor },
                    ]}
                  >
                    Rationale:{' '}
                    <Text
                      style={[textStyles.defaultSemiBold, { color: textColor }]}
                    >
                      {submission.rationale.trim()}
                    </Text>
                  </Text>
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
                <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                  Back to tasks
                </Text>
              </Pressable>
            ) : (
              <Text
                style={[
                  textStyles.default,
                  styles.hint,
                  { color: textColor, opacity: 0.7 },
                ]}
              >
                We’ll update this screen automatically.
              </Text>
            )}

            {!submissionId ? (
              <Text style={[textStyles.default, styles.hint, { color: tint }]}>
                Missing submission id.
              </Text>
            ) : null}

            <View
              style={[
                styles.statusPill,
                { borderColor: border, backgroundColor: 'transparent' },
              ]}
            >
              <Text
                style={[
                  textStyles.default,
                  styles.pillText,
                  { color: textColor },
                ]}
              >
                Status:{' '}
                <Text
                  style={[textStyles.defaultSemiBold, { color: textColor }]}
                >
                  {status}
                </Text>
              </Text>
            </View>
          </View>
        </SafeScreen>
      </ScreenState>
    </>
  );
}

const styles = StyleSheet.create({
  headerBack: {
    paddingHorizontal: 6,
    paddingVertical: 6,
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
