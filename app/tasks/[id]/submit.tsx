import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';

import { screenStyles, textStyles, useAppTheme } from '@/lib/ui';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';
import { getSavedTeamId, saveTeamId } from '@/lib/team-session';

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

export default function TaskSubmitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, textColor, backgroundColor, border, tint } = useAppTheme();

  const [task, setTask] = useState<Task | null>(null);
  const [isLoadingTask, setIsLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState<unknown>(undefined);

  const [teamId, setTeamId] = useState('');
  const [textAnswer, setTextAnswer] = useState('');
  const [photoAsset, setPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccessId, setSubmitSuccessId] = useState<string | null>(null);

  const taskId = String(id ?? '');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = await getSavedTeamId();
      if (!mounted) return;
      if (saved && !teamId.trim()) setTeamId(saved);
    })();
    return () => {
      mounted = false;
    };
    // Intentionally only runs once; don't override manual edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const canSubmit = useMemo(() => {
    if (!taskId.trim()) return false;
    if (!teamId.trim()) return false;
    if (!submissionType) return false;
    if (isSubmitting) return false;
    if (wantsText && wantsPhoto) {
      return Boolean(textAnswer.trim() || photoAsset);
    }
    if (wantsText) return Boolean(textAnswer.trim());
    if (wantsPhoto) return Boolean(photoAsset);
    return false;
  }, [
    isSubmitting,
    photoAsset,
    submissionType,
    taskId,
    teamId,
    textAnswer,
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
      await saveTeamId(teamId);

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
  }, [canSubmit, photoAsset, taskId, teamId, textAnswer]);

  const onBackToTasks = useCallback(() => {
    router.replace('/(tabs)');
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Submit',
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
      <View style={[screenStyles.container, { backgroundColor }]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[textStyles.title, { color: textColor }]}>
            Submission
          </Text>

          {isLoadingTask ? (
            <Text
              style={[textStyles.default, styles.hint, { color: textColor }]}
            >
              Loading task…
            </Text>
          ) : task ? (
            <View style={styles.taskHeader}>
              <Text style={[textStyles.subtitle, { color: textColor }]}>
                {task.title}
              </Text>
              {task.description?.trim() ? (
                <Text
                  style={[
                    textStyles.default,
                    styles.description,
                    { color: textColor },
                  ]}
                >
                  {task.description}
                </Text>
              ) : null}
              <Text
                style={[textStyles.default, styles.hint, { color: textColor }]}
              >
                Submission type:{' '}
                <Text
                  style={[textStyles.defaultSemiBold, { color: textColor }]}
                >
                  {task.type}
                </Text>
              </Text>
              <Text
                style={[textStyles.default, styles.hint, { color: textColor }]}
              >
                Points:{' '}
                <Text
                  style={[textStyles.defaultSemiBold, { color: textColor }]}
                >
                  {task.max_points}
                </Text>
              </Text>
            </View>
          ) : (
            <Text
              style={[textStyles.default, styles.hint, { color: textColor }]}
            >
              Couldn’t load this task. Pull to refresh the task list and try
              again.
            </Text>
          )}

          {taskError ? (
            <Text style={[textStyles.default, styles.hint, { color: tint }]}>
              Failed to load task list.
            </Text>
          ) : null}

          <View style={styles.field}>
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Team ID
            </Text>
            <TextInput
              value={teamId}
              onChangeText={setTeamId}
              placeholder="Enter your team ID (we’ll remember it)"
              placeholderTextColor={border}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
              style={[
                styles.input,
                { borderColor: border, color: colors.text },
              ]}
            />
          </View>

          {wantsText ? (
            <View style={styles.field}>
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                Text answer
              </Text>
              <TextInput
                value={textAnswer}
                onChangeText={setTextAnswer}
                placeholder="Type your answer…"
                placeholderTextColor={border}
                editable={!isSubmitting}
                multiline
                style={[
                  styles.textarea,
                  { borderColor: border, color: colors.text },
                ]}
              />
            </View>
          ) : null}

          {wantsPhoto ? (
            <View style={styles.field}>
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                Photo
              </Text>
              <View style={styles.photoRow}>
                <Pressable
                  onPress={onTakePhoto}
                  disabled={isSubmitting}
                  style={({ pressed }) => [
                    styles.button,
                    { borderColor: tint },
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                    {cameraAvailable === false
                      ? 'Camera unavailable'
                      : photoAsset
                        ? 'Retake photo'
                        : 'Take photo'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onPickPhoto}
                  disabled={isSubmitting}
                  style={({ pressed }) => [
                    styles.button,
                    { borderColor: tint },
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                    {photoAsset ? 'Pick different' : 'Pick from library'}
                  </Text>
                </Pressable>
                {photoAsset ? (
                  <Pressable
                    onPress={onRemovePhoto}
                    disabled={isSubmitting}
                    style={({ pressed }) => [
                      styles.button,
                      { borderColor: border },
                      pressed ? styles.buttonPressed : null,
                    ]}
                  >
                    <Text
                      style={[textStyles.defaultSemiBold, { color: textColor }]}
                    >
                      Remove
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {photoAsset ? (
                <>
                  <Text
                    style={[
                      textStyles.default,
                      styles.hint,
                      { color: textColor },
                    ]}
                    numberOfLines={2}
                    ellipsizeMode="middle"
                  >
                    Selected: {displayAssetLabel(photoAsset)}
                  </Text>
                  <View style={styles.previewFrame}>
                    <Image
                      source={{ uri: photoAsset.uri }}
                      style={styles.previewImage}
                      contentFit="cover"
                      accessibilityLabel="Selected photo preview"
                    />
                  </View>
                </>
              ) : (
                <Text
                  style={[
                    textStyles.default,
                    styles.hint,
                    { color: textColor },
                  ]}
                >
                  No photo selected.
                </Text>
              )}
            </View>
          ) : null}

          {submitError ? (
            <Text
              style={[textStyles.default, styles.errorText, { color: tint }]}
            >
              {submitError}
            </Text>
          ) : null}

          {submitSuccessId ? (
            <Text
              style={[
                textStyles.default,
                styles.successText,
                { color: textColor },
              ]}
            >
              Submitted. ID:{' '}
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                {submitSuccessId}
              </Text>
            </Text>
          ) : null}

          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submitButton,
              { backgroundColor: canSubmit ? tint : border },
              pressed && canSubmit ? styles.submitPressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, styles.submitText]}>
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  headerBack: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  content: {
    gap: 8,
    paddingBottom: 24,
  },
  taskHeader: {
    gap: 4,
  },
  description: {
    opacity: 0.9,
  },
  hint: {
    opacity: 0.85,
  },
  field: {
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  photoRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  button: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  previewFrame: {
    marginTop: 10,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  previewImage: {
    width: '100%',
    height: 220,
  },
  errorText: {
    opacity: 0.95,
  },
  successText: {
    opacity: 0.95,
  },
  submitButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  submitPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }],
  },
  submitText: {
    color: 'white',
  },
});
