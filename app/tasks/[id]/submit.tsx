import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { apiUrl } from '@/lib/api';
import { httpJson } from '@/lib/http';
import { uploadSubmissionPhoto } from '@/lib/storage';

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

export default function TaskSubmitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useColorScheme() ?? 'light';
  const border = Colors[theme].icon;
  const tint = Colors[theme].tint;

  const [task, setTask] = useState<Task | null>(null);
  const [isLoadingTask, setIsLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState<unknown>(undefined);

  const [teamId, setTeamId] = useState('');
  const [textAnswer, setTextAnswer] = useState('');
  const [photoAsset, setPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccessId, setSubmitSuccessId] = useState<string | null>(null);

  const taskId = String(id ?? '');

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
    setPhotoPath(null);

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
    setPhotoPath(null);

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
    setPhotoPath(null);
  }, []);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccessId(null);

    try {
      let uploadedPath: string | null = photoPath;

      if (photoAsset && !uploadedPath) {
        setIsUploadingPhoto(true);
        try {
          const { path } = await uploadSubmissionPhoto({
            asset: photoAsset,
            teamId,
            taskId,
          });
          uploadedPath = path;
          setPhotoPath(path);
        } catch (e) {
          setSubmitError(
            e instanceof Error
              ? e.message
              : 'Photo upload failed. Please try again.',
          );
          return;
        } finally {
          setIsUploadingPhoto(false);
        }
      }

      const fd = new FormData();
      fd.append('task_id', taskId);
      fd.append('team_id', teamId.trim());

      if (textAnswer.trim()) {
        fd.append('text_answer', textAnswer);
      }

      if (uploadedPath) {
        fd.append('photo_path', uploadedPath);
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
        setSubmitError('Submission failed. Please try again.');
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
      setIsUploadingPhoto(false);
      setIsSubmitting(false);
    }
  }, [canSubmit, photoAsset, photoPath, taskId, teamId, textAnswer]);

  return (
    <>
      <Stack.Screen options={{ title: 'Submit' }} />
      <ThemedView style={styles.container}>
        <View style={styles.content}>
          <ThemedText type="title">Submission</ThemedText>

          {isLoadingTask ? (
            <ThemedText style={styles.hint}>Loading task…</ThemedText>
          ) : task ? (
            <View style={styles.taskHeader}>
              <ThemedText type="subtitle">{task.title}</ThemedText>
              <ThemedText style={styles.hint}>
                Submission type:{' '}
                <ThemedText type="defaultSemiBold">{task.type}</ThemedText>
              </ThemedText>
            </View>
          ) : (
            <ThemedText style={styles.hint}>
              Couldn’t load task. (id: {taskId})
            </ThemedText>
          )}

          {taskError ? (
            <ThemedText style={[styles.hint, { color: tint }]}>
              Failed to load task list.
            </ThemedText>
          ) : null}

          <View style={styles.field}>
            <ThemedText type="defaultSemiBold">Team ID</ThemedText>
            <TextInput
              value={teamId}
              onChangeText={setTeamId}
              placeholder="UUID of your team"
              placeholderTextColor={border}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
              style={[
                styles.input,
                { borderColor: border, color: Colors[theme].text },
              ]}
            />
          </View>

          {wantsText ? (
            <View style={styles.field}>
              <ThemedText type="defaultSemiBold">Text answer</ThemedText>
              <TextInput
                value={textAnswer}
                onChangeText={setTextAnswer}
                placeholder="Type your answer…"
                placeholderTextColor={border}
                editable={!isSubmitting}
                multiline
                style={[
                  styles.textarea,
                  { borderColor: border, color: Colors[theme].text },
                ]}
              />
            </View>
          ) : null}

          {wantsPhoto ? (
            <View style={styles.field}>
              <ThemedText type="defaultSemiBold">Photo</ThemedText>
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
                  <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                    {cameraAvailable === false
                      ? 'Camera unavailable'
                      : photoAsset
                        ? 'Retake photo'
                        : 'Take photo'}
                  </ThemedText>
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
                  <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                    {photoAsset ? 'Pick different' : 'Pick from library'}
                  </ThemedText>
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
                    <ThemedText type="defaultSemiBold">Remove</ThemedText>
                  </Pressable>
                ) : null}
              </View>
              {photoAsset ? (
                <>
                  <ThemedText style={styles.hint}>
                    Selected: {photoAsset.fileName ?? photoAsset.uri}
                  </ThemedText>
                  <View style={styles.previewFrame}>
                    <Image
                      source={{ uri: photoAsset.uri }}
                      style={styles.previewImage}
                      contentFit="cover"
                      accessibilityLabel="Selected photo preview"
                    />
                  </View>
                  {photoPath ? (
                    <ThemedText style={styles.hint}>
                      Uploaded path:{' '}
                      <ThemedText type="defaultSemiBold">{photoPath}</ThemedText>
                    </ThemedText>
                  ) : null}
                  {isUploadingPhoto ? (
                    <ThemedText style={styles.hint}>Uploading photo…</ThemedText>
                  ) : null}
                </>
              ) : (
                <ThemedText style={styles.hint}>No photo selected.</ThemedText>
              )}
            </View>
          ) : null}

          {submitError ? (
            <ThemedText style={[styles.errorText, { color: tint }]}>
              {submitError}
            </ThemedText>
          ) : null}

          {submitSuccessId ? (
            <ThemedText style={styles.successText}>
              Submitted. ID:{' '}
              <ThemedText type="defaultSemiBold">{submitSuccessId}</ThemedText>
            </ThemedText>
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
            <ThemedText type="defaultSemiBold" style={styles.submitText}>
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
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
  taskHeader: {
    gap: 4,
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
