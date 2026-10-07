import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { SafeScreen } from '@/components/safe-screen';
import { ScreenState } from '@/components/screen-state';
import {
  AppButton,
  AppCard,
  AppChip,
  AppText,
  IconSymbol,
  NavBar,
} from '@/components/ui';
import type { AppChipTone } from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Radius, Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';
import { useAppTheme } from '@/lib/ui';

type Submission = {
  id: string;
  task_id?: string | null;
  team_id?: string | null;
  status?: string | null;
  score?: number | null;
  rationale?: string | null;
  confidence?: number | null;
  created_at?: string | null;
  text_answer?: string | null;
  /** Short-lived signed URL minted by the backend for the stored photo. */
  photo_signed_url?: string | null;
};

function normalizeStatus(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s || 'pending';
}

function statusMeta(status: string): {
  label: string;
  tone: AppChipTone;
  icon: IconSymbolName;
} {
  switch (status) {
    case 'auto_approved':
    case 'approved':
      return { label: 'Approved', tone: 'success', icon: 'checkmark.seal.fill' };
    case 'reviewed':
      return { label: 'Reviewed', tone: 'accent', icon: 'checkmark.circle.fill' };
    case 'flagged':
      return {
        label: 'Under review',
        tone: 'warning',
        icon: 'exclamationmark.triangle.fill',
      };
    case 'error':
      return { label: 'Error', tone: 'danger', icon: 'xmark.circle.fill' };
    default:
      return { label: 'Processing', tone: 'neutral', icon: 'clock.fill' };
  }
}

export default function SubmissionConfirmationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const submissionId = String(id ?? '').trim();

  const { colors } = useAppTheme();

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

  const meta = statusMeta(status);

  const score = submission?.score;
  const hasScore = score != null && Number.isFinite(Number(score));

  const confidencePct = useMemo(() => {
    const raw = submission?.confidence;
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const pct = n <= 1 ? n * 100 : n;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }, [submission?.confidence]);

  const rationale = submission?.rationale?.trim() ?? '';
  const textAnswer = submission?.text_answer?.trim() ?? '';
  const photoUrl = submission?.photo_signed_url?.trim() ?? '';

  return (
    <ScreenState
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      loadingRows={3}
    >
      <SafeScreen>
        <NavBar
          title="Submission"
          onBack={onBackToTasks}
          rightSlot={<AppChip tone={meta.tone}>{meta.label}</AppChip>}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <Animated.View entering={FadeInDown.duration(280)}>
            <AppCard>
              <View style={styles.heroTop}>
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <IconSymbol
                    name={meta.icon}
                    size={18}
                    color={colors.accent}
                  />
                </View>
                <View style={styles.heroTitleBlock}>
                  <AppText variant="overline" tone="tertiary">
                    Status
                  </AppText>
                  <AppText variant="heading" numberOfLines={2}>
                    {title}
                  </AppText>
                </View>
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.scoreRow}>
                <View style={styles.scoreBlock}>
                  <AppText variant="overline" tone="tertiary">
                    AI score
                  </AppText>
                  <AppText
                    variant="numericLarge"
                    tone={hasScore ? 'primary' : 'tertiary'}
                  >
                    {hasScore ? String(score) : '—'}
                  </AppText>
                  <AppText variant="caption" tone="tertiary">
                    {hasScore ? 'points awarded' : 'awaiting scoring'}
                  </AppText>
                </View>

                {confidencePct != null ? (
                  <View style={styles.confidenceBlock}>
                    <AppText variant="overline" tone="tertiary">
                      Confidence
                    </AppText>
                    <AppText variant="numeric">{`${confidencePct}%`}</AppText>
                    <View
                      style={[
                        styles.track,
                        { backgroundColor: colors.surfaceSunken },
                      ]}
                    >
                      <View
                        style={[
                          styles.fill,
                          {
                            backgroundColor: colors.accent,
                            width: `${confidencePct}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            </AppCard>
          </Animated.View>

          {textAnswer || photoUrl ? (
            <Animated.View entering={FadeInDown.delay(45).duration(280)}>
              <AppCard variant="outlined">
                <AppText variant="overline" tone="tertiary">
                  Your submission
                </AppText>

                {photoUrl ? (
                  <Image
                    source={{ uri: photoUrl }}
                    style={styles.photo}
                    contentFit="cover"
                    transition={200}
                  />
                ) : null}

                {textAnswer ? (
                  <AppText variant="body" style={styles.cardBody}>
                    {textAnswer}
                  </AppText>
                ) : null}
              </AppCard>
            </Animated.View>
          ) : null}

          {isError ? (
            <Animated.View entering={FadeInDown.delay(90).duration(280)}>
              <AppCard variant="outlined" style={{ borderColor: colors.danger }}>
                <AppText variant="overline" tone="tertiary">
                  What happened
                </AppText>
                <AppText
                  variant="body"
                  tone="danger"
                  style={styles.cardBody}
                >
                  {`We hit an error processing your submission${
                    rationale ? `: ${rationale}` : '.'
                  }`}
                </AppText>
              </AppCard>
            </Animated.View>
          ) : rationale ? (
            <Animated.View entering={FadeInDown.delay(45).duration(280)}>
              <AppCard variant="sunken">
                <AppText variant="overline" tone="tertiary">
                  AI rationale
                </AppText>
                <AppText variant="body" style={styles.cardBody}>
                  {rationale}
                </AppText>
              </AppCard>
            </Animated.View>
          ) : null}

          {isUnderReview ? (
            <Animated.View entering={FadeInDown.delay(90).duration(280)}>
              <AppCard variant="outlined">
                <AppText variant="overline" tone="tertiary">
                  Next step
                </AppText>
                <AppText
                  variant="callout"
                  tone="secondary"
                  style={styles.cardBody}
                >
                  Your submission was flagged and is now with an organizer for
                  manual review.
                </AppText>
              </AppCard>
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInDown.delay(135).duration(280)}>
            <AppCard variant="outlined">
              <AppText variant="overline" tone="tertiary">
                Details
              </AppText>

              <View style={styles.detailRow}>
                <AppText variant="callout" tone="secondary">
                  Submission ID
                </AppText>
                <AppText
                  variant="bodyStrong"
                  numberOfLines={1}
                  style={styles.detailValue}
                >
                  {submissionId || '—'}
                </AppText>
              </View>

              <View style={styles.detailRow}>
                <AppText variant="callout" tone="secondary">
                  Raw status
                </AppText>
                <AppText variant="bodyStrong">{status}</AppText>
              </View>
            </AppCard>
          </Animated.View>

          {!submissionId ? (
            <AppText variant="callout" tone="danger">
              Missing submission id.
            </AppText>
          ) : null}

          {isTerminal ? (
            <AppButton tone="primary" fullWidth onPress={onBackToTasks}>
              Back to tasks
            </AppButton>
          ) : (
            <View style={styles.pendingNote}>
              <IconSymbol
                name="clock.arrow.circlepath"
                size={14}
                color={colors.textTertiary}
              />
              <AppText variant="caption" tone="tertiary">
                We’ll update this screen automatically.
              </AppText>
            </View>
          )}
        </ScrollView>
      </SafeScreen>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  heroTitleBlock: {
    flex: 1,
    gap: Spacing.xxs,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    marginVertical: Spacing.base,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xl,
  },
  scoreBlock: {
    gap: Spacing.xxs,
  },
  confidenceBlock: {
    flex: 1,
    gap: Spacing.xxs,
  },
  track: {
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    marginTop: Spacing.xs,
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  photo: {
    width: '100%',
    height: 220,
    borderRadius: Radius.sm,
    marginTop: Spacing.md,
  },
  cardBody: {
    marginTop: Spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.base,
    marginTop: Spacing.md,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  pendingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs + 2,
    paddingVertical: Spacing.sm,
  },
});
