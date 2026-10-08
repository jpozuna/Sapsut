import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SafeScreen } from '@/components/safe-screen';
import {
  AppButton,
  AppCard,
  AppChip,
  AppInput,
  AppText,
  IconSymbol,
  NavBar,
  Skeleton,
} from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { HitSlop, Radius, Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';
import { useRole } from '@/lib/role-context';
import { isAppError, toAppError } from '@/lib/app-error';
import {
  isNoTeamSessionError,
  teamHeaders,
  useTeamSession,
  withTeamToken,
} from '@/lib/team-session';
import { useAppTheme } from '@/lib/ui';

type Task = {
  id: string | number;
  title: string;
  description: string | null;
  type: 'text' | 'photo' | 'combo';
  max_points: number;
};

type CreateSubmissionOk = { submission_id: string; status: string };
type CreateSubmissionError = { error: string; existing_submission_id?: string };
type CreateSubmissionResponse = CreateSubmissionOk | CreateSubmissionError;

const SESSION_EXPIRED_MESSAGE =
  'Your team session expired. Join your team again.';
const NETWORK_MESSAGE =
  "Can't reach the server. Your answer and photo are kept. Check your connection and tap Try again.";
const TEAM_MISMATCH_MESSAGE =
  'This device is signed in as a different team. Tap Change to rejoin.';
const GENERIC_MESSAGE = 'Submission failed. Please try again.';
const SUBMIT_TIMEOUT_MS = 45_000;

function serverMessage(body: CreateSubmissionResponse | null): string | null {
  if (!body || typeof body !== 'object') return null;
  if ('error' in body && typeof body.error === 'string' && body.error) {
    return body.error;
  }
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === 'string' && detail ? detail : null;
}

function isTeamMismatch(body: CreateSubmissionResponse | null): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as { detail?: unknown }).detail === 'Team mismatch.';
}

function displayAssetLabel(asset: ImagePicker.ImagePickerAsset): string {
  const name = asset.fileName?.trim();
  if (name) return name;
  const uri = asset.uri ?? '';
  const last = uri.split('?')[0]?.split('#')[0]?.split('/').pop()?.trim();
  return last || 'selected photo';
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

export default function TaskSubmitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const { role } = useRole();
  const insets = useSafeAreaInsets();

  const [task, setTask] = useState<Task | null>(null);
  const [isLoadingTask, setIsLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState<unknown>(undefined);

  const { session, isLoading: isLoadingSession } = useTeamSession();
  const [textAnswer, setTextAnswer] = useState('');
  const [photoAsset, setPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set when the server says this team already submitted for the task.
  const [existingId, setExistingId] = useState<string | null>(null);

  const taskId = String(id ?? '');

  // Organizers should not complete tasks; route them back to the task list.
  useEffect(() => {
    if (role !== 'organizer') return;
    router.replace('/(tabs)');
  }, [role]);

  // Joining (or rejoining) on /team swaps the session; drop the stale notice.
  const sessionToken = session?.token ?? null;
  useEffect(() => {
    if (!sessionToken) return;
    setSubmitError(null);
    setExistingId(null);
  }, [sessionToken]);

  const showError = useCallback((message: string, existing?: string | null) => {
    setSubmitError(message);
    setExistingId(existing ?? null);
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const clearError = useCallback(() => {
    setSubmitError(null);
    setExistingId(null);
  }, []);

  useEffect(() => {
    // `expo-image-picker` does not reliably expose a camera-availability API across SDKs.
    // Treat native platforms as "camera capable" and fallback at runtime if launching fails.
    setCameraAvailable(Platform.OS === 'ios' || Platform.OS === 'android');
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoadingTask(true);
      setTaskError(undefined);
      try {
        const tasks = await httpJson<Task[]>(apiUrl('/tasks/'));
        const found =
          Array.isArray(tasks) && taskId
            ? (tasks.find((t) => String(t.id) === taskId) ?? null)
            : null;
        if (mounted) setTask(found);
      } catch (e) {
        if (mounted) setTaskError(e);
      } finally {
        if (mounted) setIsLoadingTask(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [taskId]);

  const submissionType = task?.type;
  const wantsText = submissionType === 'text' || submissionType === 'combo';
  const wantsPhoto = submissionType === 'photo' || submissionType === 'combo';

  const hasText = Boolean(textAnswer.trim());

  const canSubmit = useMemo(() => {
    if (!taskId.trim()) return false;
    if (!session) return false;
    if (!submissionType) return false;
    if (isSubmitting) return false;
    if (wantsText && wantsPhoto) {
      return Boolean(hasText || photoAsset);
    }
    if (wantsText) return Boolean(hasText);
    if (wantsPhoto) return Boolean(photoAsset);
    return false;
  }, [
    hasText,
    isSubmitting,
    photoAsset,
    session,
    submissionType,
    taskId,
    wantsPhoto,
    wantsText,
  ]);

  const onPickPhoto = useCallback(async () => {
    clearError();

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showError('Photo permission is required to pick an image.');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.9,
    });
    if (res.canceled) return;
    const asset = res.assets?.[0] ?? null;
    setPhotoAsset(asset);
  }, [clearError, showError]);

  const onTakePhoto = useCallback(async () => {
    clearError();

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showError('Camera permission is required to take a photo.');
      return;
    }

    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.9,
      });
    } catch {
      // Fallback to library if camera isn't available (e.g., simulator) or fails to launch.
      setCameraAvailable(false);
      await onPickPhoto();
      return;
    }
    if (res.canceled) return;
    const asset = res.assets?.[0] ?? null;
    setPhotoAsset(asset);
  }, [clearError, onPickPhoto, showError]);

  const onRemovePhoto = useCallback(() => {
    setPhotoAsset(null);
  }, []);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    clearError();

    // The photo upload can be slow, but a hung request must not spin forever.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SUBMIT_TIMEOUT_MS);

    try {
      // The team comes from the X-Team-Token header; no team_id is sent.
      const fd = new FormData();
      fd.append('task_id', taskId);

      if (textAnswer.trim()) {
        fd.append('text_answer', textAnswer);
      }

      if (photoAsset?.uri) {
        // Prefer uploading via backend (works reliably in simulators and avoids direct Storage connectivity).
        // FastAPI accepts this as UploadFile via the `photo` field.
        const name =
          photoAsset.fileName?.trim() ||
          `submission-${taskId}-${Date.now()}.jpg`;
        const type = photoAsset.mimeType?.trim() || 'image/jpeg';
        if (Platform.OS === 'web') {
          // On web FormData needs a real Blob/File; a `{ uri }` object would be
          // stringified. A failure here is caught below and shown as a submit error.
          let blob: Blob =
            photoAsset.file ??
            (await (
              await fetch(photoAsset.uri, { signal: controller.signal })
            ).blob());
          if (!blob.type.startsWith('image/')) {
            blob = new Blob([blob], { type });
          }
          fd.append('photo', blob, name);
        } else {
          fd.append('photo', {
            uri: photoAsset.uri,
            name,
            type,
          } as unknown as Blob);
        }
      }

      const { res, body } = await withTeamToken(async (token) => {
        const response = await fetch(apiUrl('/submissions/'), {
          method: 'POST',
          headers: {
            accept: 'application/json',
            // NOTE: Do not set Content-Type for FormData in React Native.
            ...teamHeaders(token),
          },
          body: fd,
          signal: controller.signal,
        });
        // withTeamToken only drops the session for a thrown 401 AppError.
        if (response.status === 401) {
          throw {
            kind: 'unknown',
            status: 401,
            message: SESSION_EXPIRED_MESSAGE,
          };
        }

        let parsed: CreateSubmissionResponse | null = null;
        try {
          parsed = (await response.json()) as CreateSubmissionResponse;
        } catch {
          parsed = null;
        }
        return { res: response, body: parsed };
      });

      if (!res.ok) {
        if (res.status === 403 && isTeamMismatch(body)) {
          showError(TEAM_MISMATCH_MESSAGE);
          return;
        }
        showError(serverMessage(body) ?? GENERIC_MESSAGE);
        return;
      }

      if (body && typeof body === 'object' && 'error' in body) {
        const existing =
          typeof body.existing_submission_id === 'string' &&
          body.existing_submission_id
            ? body.existing_submission_id
            : null;
        if (existing) {
          showError('Already submitted', existing);
        } else {
          showError(
            body.error || 'Duplicate submission blocked for this task.',
          );
        }
        return;
      }

      const ok = body as CreateSubmissionOk | null;
      if (ok?.submission_id && ok?.status !== 'error') {
        router.replace({
          pathname: '/submissions/[id]',
          params: { id: ok.submission_id },
        });
      } else {
        showError(
          ok?.status === 'error'
            ? 'Photo upload failed. Please try again.'
            : GENERIC_MESSAGE,
        );
      }
    } catch (e) {
      if (isNoTeamSessionError(e)) {
        showError('Join your team to submit.');
      } else if (isAppError(e) && e.status === 401) {
        showError(SESSION_EXPIRED_MESSAGE);
      } else if (timedOut || toAppError(e).kind === 'network') {
        showError(NETWORK_MESSAGE);
      } else {
        // Never surface a raw exception message.
        showError(GENERIC_MESSAGE);
      }
    } finally {
      clearTimeout(timer);
      setIsSubmitting(false);
    }
  }, [canSubmit, clearError, photoAsset, showError, taskId, textAnswer]);

  const onJoinTeam = useCallback(() => {
    router.push('/team');
  }, []);

  const onBackToTasks = useCallback(() => {
    router.replace('/(tabs)');
  }, []);

  const onViewExisting = useCallback(() => {
    if (!existingId) return;
    router.push({
      pathname: '/submissions/[id]',
      params: { id: existingId },
    });
  }, [existingId]);

  const meta = task ? typeMeta(task.type) : null;
  const showJoin = !isLoadingSession && !session;
  const teamName = session?.teamName.trim() || 'Unnamed team';

  return (
    <SafeScreen>
      <NavBar title="Submit answer" onBack={onBackToTasks} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={Spacing.xxl}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isLoadingTask ? (
            <AppCard>
              <View style={styles.briefSkeleton}>
                <Skeleton width="65%" height={22} />
                <Skeleton width="95%" height={14} />
                <Skeleton width="80%" height={14} />
                <Skeleton width={96} height={24} radius={Radius.pill} />
              </View>
            </AppCard>
          ) : task ? (
            <Animated.View entering={FadeInDown.duration(280)}>
              <AppCard>
                <View style={styles.briefHeader}>
                  <View style={styles.briefTitle}>
                    <AppText variant="overline" tone="tertiary">
                      Task brief
                    </AppText>
                    <AppText variant="heading" style={styles.briefHeading}>
                      {task.title}
                    </AppText>
                  </View>
                  <View
                    style={[
                      styles.points,
                      { backgroundColor: colors.surfaceSunken },
                    ]}
                  >
                    <AppText variant="numeric" style={styles.pointsValue}>
                      {String(task.max_points)}
                    </AppText>
                    <AppText variant="overline" tone="tertiary">
                      pts
                    </AppText>
                  </View>
                </View>

                {task.description?.trim() ? (
                  <AppText
                    variant="body"
                    tone="secondary"
                    style={styles.briefDescription}
                  >
                    {task.description}
                  </AppText>
                ) : null}

                {meta ? (
                  <View style={styles.briefFooter}>
                    <AppChip
                      tone="accent"
                      size="md"
                      icon={
                        <IconSymbol
                          name={meta.icon}
                          size={13}
                          color={colors.accentOnSoft}
                        />
                      }
                    >
                      {meta.label}
                    </AppChip>
                  </View>
                ) : null}
              </AppCard>
            </Animated.View>
          ) : (
            <AppCard
              variant="outlined"
              style={{ backgroundColor: colors.warningSoft }}
            >
              <View style={styles.noticeRow}>
                <IconSymbol
                  name="exclamationmark.triangle.fill"
                  size={18}
                  color={colors.warning}
                />
                <AppText
                  variant="callout"
                  style={[styles.noticeText, { color: colors.onWarningSoft }]}
                >
                  Couldn’t load this task. Pull to refresh the task list and try
                  again.
                </AppText>
              </View>
            </AppCard>
          )}

          {taskError ? (
            <AppCard
              variant="outlined"
              style={{ backgroundColor: colors.dangerSoft }}
            >
              <View style={styles.noticeRow}>
                <IconSymbol name="wifi.slash" size={18} color={colors.danger} />
                <AppText
                  variant="callout"
                  style={[styles.noticeText, { color: colors.onDangerSoft }]}
                >
                  Failed to load task list.
                </AppText>
              </View>
            </AppCard>
          ) : null}

          <View style={styles.section}>
            <AppText
              variant="overline"
              tone="tertiary"
              accessibilityRole="header"
            >
              Your team
            </AppText>
            <AppCard variant="outlined">
              <View style={styles.teamRow}>
                <View
                  style={[
                    styles.teamIcon,
                    { backgroundColor: colors.accentSoft },
                  ]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <IconSymbol
                    name="person.2.fill"
                    size={17}
                    color={colors.accent}
                  />
                </View>
                <View
                  style={styles.teamBody}
                  accessible={Boolean(session)}
                  accessibilityLabel={
                    session ? `Submitting as ${teamName}` : undefined
                  }
                >
                  {isLoadingSession ? (
                    <Skeleton width="55%" height={18} />
                  ) : session ? (
                    <AppText variant="title" numberOfLines={2}>
                      {`Submitting as ${teamName}`}
                    </AppText>
                  ) : (
                    <AppText variant="callout" tone="secondary">
                      Join your team with its invite code to submit.
                    </AppText>
                  )}
                </View>
                {session ? (
                  <AppButton
                    tone="ghost"
                    size="md"
                    onPress={onJoinTeam}
                    disabled={isSubmitting}
                    accessibilityLabel="Change team"
                  >
                    Change
                  </AppButton>
                ) : null}
              </View>
            </AppCard>
          </View>

          {wantsText ? (
            <View style={styles.section}>
              <AppText variant="overline" tone="tertiary">
                Your answer
              </AppText>
              <AppInput
                label="Text answer"
                value={textAnswer}
                onChangeText={setTextAnswer}
                placeholder="Type your answer…"
                hint={`${textAnswer.trim().length} characters`}
                editable={!isSubmitting}
                multiline
              />
            </View>
          ) : null}

          {wantsPhoto ? (
            <View style={styles.section}>
              <AppText variant="overline" tone="tertiary">
                Your photo
              </AppText>

              {photoAsset ? (
                <View style={styles.dropzoneFilled}>
                  <View
                    style={[
                      styles.previewFrame,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Image
                      source={{ uri: photoAsset.uri }}
                      style={styles.previewImage}
                      contentFit="cover"
                      accessibilityLabel="Selected photo preview"
                    />
                    <Pressable
                      onPress={onRemovePhoto}
                      disabled={isSubmitting}
                      hitSlop={HitSlop}
                      accessibilityRole="button"
                      accessibilityLabel="Remove selected photo"
                      style={[
                        styles.removeBadge,
                        { backgroundColor: colors.scrim },
                      ]}
                    >
                      <IconSymbol
                        name="xmark"
                        size={15}
                        color={colors.textInverse}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.assetRow}>
                    <IconSymbol
                      name="checkmark.circle.fill"
                      size={15}
                      color={colors.success}
                    />
                    <AppText
                      variant="caption"
                      tone="tertiary"
                      numberOfLines={1}
                      style={styles.assetLabel}
                    >
                      {displayAssetLabel(photoAsset)}
                    </AppText>
                  </View>

                  <View style={styles.photoActions}>
                    <AppButton
                      tone="secondary"
                      size="sm"
                      onPress={onTakePhoto}
                      disabled={isSubmitting}
                      icon={
                        <IconSymbol
                          name="camera.fill"
                          size={15}
                          color={colors.textPrimary}
                        />
                      }
                    >
                      {cameraAvailable === false
                        ? 'Camera unavailable'
                        : 'Retake photo'}
                    </AppButton>
                    <AppButton
                      tone="ghost"
                      size="sm"
                      onPress={onPickPhoto}
                      disabled={isSubmitting}
                    >
                      Pick different
                    </AppButton>
                  </View>
                </View>
              ) : (
                <View style={styles.dropzoneFilled}>
                  <Pressable
                    onPress={onPickPhoto}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Pick a photo from your library"
                    style={({ pressed }) => [
                      styles.dropzone,
                      {
                        backgroundColor: colors.surfaceSunken,
                        borderColor: pressed
                          ? colors.accent
                          : colors.borderStrong,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.dropzoneIcon,
                        { backgroundColor: colors.accentSoft },
                      ]}
                    >
                      <IconSymbol
                        name="photo.badge.plus"
                        size={26}
                        color={colors.accent}
                      />
                    </View>
                    <AppText variant="title">Add a photo</AppText>
                    <AppText
                      variant="caption"
                      tone="tertiary"
                      align="center"
                      style={styles.dropzoneHint}
                    >
                      Tap to choose from your library
                    </AppText>
                  </Pressable>

                  <View style={styles.photoActions}>
                    <AppButton
                      tone="secondary"
                      size="sm"
                      onPress={onTakePhoto}
                      disabled={isSubmitting}
                      icon={
                        <IconSymbol
                          name="camera.fill"
                          size={15}
                          color={colors.textPrimary}
                        />
                      }
                    >
                      {cameraAvailable === false
                        ? 'Camera unavailable'
                        : 'Take photo'}
                    </AppButton>
                  </View>
                </View>
              )}
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              borderTopColor: colors.border,
              paddingBottom: Math.max(Spacing.lg, insets.bottom + Spacing.sm),
            },
          ]}
        >
          {submitError ? (
            <View
              style={[
                styles.footerAlert,
                { backgroundColor: colors.dangerSoft },
              ]}
              accessibilityRole="alert"
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <IconSymbol
                  name="exclamationmark.triangle.fill"
                  size={18}
                  color={colors.danger}
                />
              </View>
              <AppText
                variant="callout"
                style={[styles.noticeText, { color: colors.onDangerSoft }]}
              >
                {submitError}
              </AppText>
            </View>
          ) : null}

          {showJoin ? (
            <AppButton
              fullWidth
              size="lg"
              onPress={onJoinTeam}
              icon={
                <IconSymbol
                  name="person.2.fill"
                  size={18}
                  color={colors.onAccent}
                />
              }
            >
              Join your team
            </AppButton>
          ) : existingId ? (
            <AppButton fullWidth size="lg" onPress={onViewExisting}>
              View submission
            </AppButton>
          ) : (
            <AppButton
              fullWidth
              size="lg"
              onPress={onSubmit}
              disabled={!canSubmit}
              loading={isSubmitting}
            >
              {submitError && session ? 'Try again' : 'Submit'}
            </AppButton>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  briefSkeleton: {
    gap: Spacing.md,
  },
  briefHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  briefTitle: {
    flex: 1,
    gap: Spacing.xs,
  },
  briefHeading: {
    marginTop: Spacing.xxs,
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
  briefDescription: {
    marginTop: Spacing.md,
  },
  briefFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.base,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  noticeText: {
    flex: 1,
  },
  section: {
    gap: Spacing.md,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  teamIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamBody: {
    flex: 1,
  },
  dropzoneFilled: {
    gap: Spacing.md,
  },
  dropzone: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 190,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  dropzoneIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  dropzoneHint: {
    maxWidth: 240,
  },
  previewFrame: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
  },
  previewImage: {
    width: '100%',
    height: 240,
  },
  removeBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
  },
  assetLabel: {
    flex: 1,
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  footer: {
    gap: Spacing.md,
    paddingTop: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.sm,
  },
});
