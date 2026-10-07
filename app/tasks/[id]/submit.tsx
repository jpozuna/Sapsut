import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { getSavedTeamId, saveTeamId } from '@/lib/team-session';
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

  const [task, setTask] = useState<Task | null>(null);
  const [isLoadingTask, setIsLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState<unknown>(undefined);

  const [teamId, setTeamId] = useState('');
  const [textAnswer, setTextAnswer] = useState('');
  const [photoAsset, setPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);
  const [teamTouched, setTeamTouched] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccessId, setSubmitSuccessId] = useState<string | null>(null);

  const taskId = String(id ?? '');

  // Organizers should not complete tasks; route them back to the task list.
  useEffect(() => {
    if (role !== 'organizer') return;
    router.replace('/(tabs)');
  }, [role]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Do not leak participant autofill into organizer sessions.
      const saved = await getSavedTeamId(
        role === 'organizer' ? 'organizer' : 'participant',
      );
      if (!mounted) return;
      if (saved && !teamId.trim()) setTeamId(saved);
    })();
    return () => {
      mounted = false;
    };
    // Intentionally only runs once; don't override manual edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

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
    if (!teamId.trim()) return false;
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
    submissionType,
    taskId,
    teamId,
    wantsPhoto,
    wantsText,
  ]);

  const onPickPhoto = useCallback(async () => {
    setSubmitError(null);
    setSubmitSuccessId(null);

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setSubmitError('Photo permission is required to pick an image.');
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
  }, []);

  const onTakePhoto = useCallback(async () => {
    setSubmitError(null);
    setSubmitSuccessId(null);

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setSubmitError('Camera permission is required to take a photo.');
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
  }, [onPickPhoto]);

  const onRemovePhoto = useCallback(() => {
    setPhotoAsset(null);
  }, []);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccessId(null);

    try {
      await saveTeamId(
        teamId,
        role === 'organizer' ? 'organizer' : 'participant',
      );

      const fd = new FormData();
      fd.append('task_id', taskId);
      fd.append('team_id', teamId.trim());

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
        fd.append('photo', {
          uri: photoAsset.uri,
          name,
          type,
        } as unknown as Blob);
      }

      const res = await fetch(apiUrl('/submissions/'), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          // NOTE: Do not set Content-Type for FormData in React Native.
        },
        body: fd,
      });

      let body: CreateSubmissionResponse | null = null;
      try {
        body = (await res.json()) as CreateSubmissionResponse;
      } catch {
        body = null;
      }

      if (!res.ok) {
        setSubmitError(
          body && typeof body === 'object'
            ? 'error' in body && typeof body.error === 'string' && body.error
              ? body.error
              : 'detail' in body &&
                  typeof body.detail === 'string' &&
                  body.detail
                ? body.detail
                : 'Submission failed. Please try again.'
            : 'Submission failed. Please try again.',
        );
        return;
      }

      if (body && typeof body === 'object' && 'error' in body) {
        setSubmitError(
          body.error || 'Duplicate submission blocked for this task.',
        );
        return;
      }

      const ok = body as CreateSubmissionOk | null;
      if (ok?.submission_id && ok?.status !== 'error') {
        setSubmitSuccessId(ok.submission_id);
        router.replace({
          pathname: '/submissions/[id]',
          params: { id: ok.submission_id },
        });
      } else {
        setSubmitError(
          ok?.status === 'error'
            ? 'Photo upload failed. Please try again.'
            : 'Submission failed. Please try again.',
        );
      }
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'Submission failed. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, photoAsset, role, taskId, teamId, textAnswer]);

  const onBackToTasks = useCallback(() => {
    router.replace('/(tabs)');
  }, []);

  const meta = task ? typeMeta(task.type) : null;
  const teamFieldError =
    teamTouched && !teamId.trim() ? 'Enter your team ID to submit.' : undefined;

  return (
    <SafeScreen>
      <NavBar title="Submit answer" onBack={onBackToTasks} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            <AppText variant="overline" tone="tertiary">
              Your team
            </AppText>
            <AppInput
              label="Team ID"
              value={teamId}
              onChangeText={setTeamId}
              onBlur={() => setTeamTouched(true)}
              placeholder="e.g. huskies-07"
              hint="We’ll remember this for your next submission."
              error={teamFieldError}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
              returnKeyType="done"
            />
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

          {submitError ? (
            <AppCard
              variant="outlined"
              style={{ backgroundColor: colors.dangerSoft }}
            >
              <View style={styles.noticeRow}>
                <IconSymbol
                  name="exclamationmark.triangle.fill"
                  size={18}
                  color={colors.danger}
                />
                <AppText
                  variant="callout"
                  style={[styles.noticeText, { color: colors.onDangerSoft }]}
                >
                  {submitError}
                </AppText>
              </View>
            </AppCard>
          ) : null}

          {submitSuccessId ? (
            <AppCard
              variant="outlined"
              style={{ backgroundColor: colors.successSoft }}
            >
              <View style={styles.noticeRow}>
                <IconSymbol
                  name="checkmark.circle.fill"
                  size={18}
                  color={colors.success}
                />
                <AppText
                  variant="callout"
                  style={[styles.noticeText, { color: colors.onSuccessSoft }]}
                >
                  {`Submitted. ID: ${submitSuccessId}`}
                </AppText>
              </View>
            </AppCard>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <AppButton
            fullWidth
            size="lg"
            onPress={onSubmit}
            disabled={!canSubmit}
            loading={isSubmitting}
          >
            Submit
          </AppButton>
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
    paddingTop: Spacing.base,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
