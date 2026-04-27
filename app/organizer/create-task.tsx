import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SafeScreen } from '@/components/safe-screen';
import { toAppError } from '@/lib/app-error';
import { organizerJson } from '@/lib/organizer-api';
import { organizerUploadJson } from '@/lib/organizer-upload';
import { useRole } from '@/lib/role-context';
import { textStyles, useAppTheme } from '@/lib/ui';

type CreatedTask = {
  id: string;
  title: string;
  description: string | null;
  type: 'text' | 'photo' | 'combo';
  max_points: number;
};

type CriteriaIn = {
  criteria_type: 'exact' | 'rubric' | 'other';
  value: string;
};

type TaskPhoto = {
  id: string;
  task_id: string;
  path: string;
  created_at?: string | null;
  signed_url?: string | null;
};

function assetLabel(asset: ImagePicker.ImagePickerAsset): string {
  return (
    asset.fileName?.trim() ||
    asset.uri?.split('?')[0]?.split('#')[0]?.split('/').pop()?.trim() ||
    'selected photo'
  );
}

export default function OrganizerCreateTaskScreen() {
  const { taskId: editTaskIdParam } = useLocalSearchParams<{
    taskId?: string;
  }>();
  const { colors, textColor, backgroundColor, tint, border } = useAppTheme();
  const {
    role,
    organizerCode: sessionOrganizerCode,
    setOrganizerCode: setSessionOrganizerCode,
    setRole,
  } = useRole();

  const [organizerCode, setOrganizerCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const didPrefillOrganizerCodeRef = useRef(false);
  useEffect(() => {
    if (didPrefillOrganizerCodeRef.current) return;
    const trimmed = sessionOrganizerCode.trim();
    if (!trimmed) return;
    didPrefillOrganizerCodeRef.current = true;
    setOrganizerCode(trimmed);
  }, [sessionOrganizerCode]);

  useEffect(() => {
    const trimmed = organizerCode.trim();
    const sessionTrimmed = sessionOrganizerCode.trim();
    if (trimmed === sessionTrimmed) return;
    if (trimmed) {
      if (role !== 'organizer') setRole('organizer');
      setSessionOrganizerCode(trimmed);
      return;
    }
    setSessionOrganizerCode('');
  }, [
    organizerCode,
    role,
    sessionOrganizerCode,
    setRole,
    setSessionOrganizerCode,
  ]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState<'text' | 'photo' | 'combo'>('combo');
  const [maxPoints, setMaxPoints] = useState('10');

  const [criteria, setCriteria] = useState<string[]>(['']);
  const [isSavingCriteria, setIsSavingCriteria] = useState(false);
  const [rubricOcrAsset, setRubricOcrAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isOcring, setIsOcring] = useState(false);

  const [isCreating, setIsCreating] = useState(false);
  const [createStep, setCreateStep] = useState<string | null>(null);
  const [createdTask, setCreatedTask] = useState<CreatedTask | null>(null);
  const editTaskId = String(editTaskIdParam ?? '').trim();

  // If we arrived with a taskId, load it for editing.
  useEffect(() => {
    if (!editTaskId) return;
    if (!organizerCode.trim()) return;
    let mounted = true;
    (async () => {
      setError(null);
      try {
        const row = await organizerJson<CreatedTask>(
          `/organizer/tasks/${encodeURIComponent(editTaskId)}`,
          organizerCode,
        );
        if (!mounted) return;
        setCreatedTask(row);
        setTitle(row.title ?? '');
        setDescription(row.description ?? '');
        setTaskType(row.type ?? 'combo');
        setMaxPoints(String(row.max_points ?? 0));
      } catch (e) {
        if (!mounted) return;
        setError(toAppError(e).message ?? 'Failed to load task.');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [editTaskId, organizerCode]);

  const canCreate = useMemo(() => {
    if (!organizerCode.trim()) return false;
    if (!title.trim()) return false;
    const mp = Number(maxPoints.trim());
    if (!Number.isFinite(mp) || mp < 0) return false;
    return !isCreating;
  }, [isCreating, maxPoints, organizerCode, title]);

  const onCreateTask = useCallback(async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setCreateStep('Creating task…');
    setError(null);
    try {
      const mp = Number(maxPoints.trim());
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        type: taskType,
        max_points: Math.floor(mp),
        is_active: true,
      };
      let taskIdToUse = createdTask?.id ?? '';
      if (createdTask?.id) {
        await organizerJson(
          `/organizer/tasks/${createdTask.id}`,
          organizerCode,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        taskIdToUse = createdTask.id;
      } else {
        const res = await organizerJson<CreatedTask[]>(
          '/organizer/tasks',
          organizerCode,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        const row = Array.isArray(res) ? (res[0] ?? null) : null;
        if (!row?.id) throw new Error('Task creation failed.');
        setCreatedTask(row);
        taskIdToUse = row.id;
      }

      // Optional: if a rubric image is selected, OCR it now (after we have a task id).
      if (taskIdToUse && rubricOcrAsset?.uri) {
        setCreateStep('Parsing rubric…');
        const fd = new FormData();
        const name =
          rubricOcrAsset.fileName?.trim() ||
          `rubric-${taskIdToUse}-${Date.now()}.jpg`;
        const type = rubricOcrAsset.mimeType?.trim() || 'image/jpeg';
        fd.append('image', {
          uri: rubricOcrAsset.uri,
          name,
          type,
        } as unknown as Blob);
        const out = await organizerUploadJson<{
          text: string;
          criteria: string[];
        }>(`/organizer/tasks/${taskIdToUse}/rubric-ocr`, organizerCode, fd);
        const incoming = Array.isArray(out?.criteria) ? out.criteria : [];
        const seen = new Set(criteria.map((x) => x.trim()).filter(Boolean));
        const merged = [...criteria];
        for (const c of incoming) {
          const v = String(c ?? '').trim();
          if (!v) continue;
          if (seen.has(v)) continue;
          seen.add(v);
          merged.push(v);
        }
        // Update UI state immediately.
        setCriteria(merged.length ? merged : ['']);
      }

      // Save rubric criteria (if any) now so the user doesn't have to press another button.
      if (taskIdToUse) {
        const cleaned = criteria.map((c) => c.trim()).filter(Boolean);
        if (cleaned.length) {
          setCreateStep('Saving rubric…');
          await organizerJson(
            `/organizer/tasks/${taskIdToUse}/criteria`,
            organizerCode,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                criteria: cleaned.map((v) => ({
                  criteria_type: 'rubric',
                  value: v,
                })),
              }),
            },
          );
        }
      }

      setCreateStep(null);
      // Return to the Tasks list so the organizer can see the newly created task.
      router.replace('/(tabs)');
    } catch (e) {
      setError(toAppError(e).message ?? 'Failed to create task.');
    } finally {
      setIsCreating(false);
      setCreateStep(null);
    }
  }, [
    canCreate,
    createdTask?.id,
    criteria,
    description,
    maxPoints,
    organizerCode,
    rubricOcrAsset,
    taskType,
    title,
  ]);

  const onPickRubricImage = useCallback(async () => {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo permission is required to pick an image.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.9,
    });
    if (res.canceled) return;
    setRubricOcrAsset(res.assets?.[0] ?? null);
  }, []);

  const onRunRubricOcr = useCallback(async () => {
    if (!createdTask?.id) return;
    if (!organizerCode.trim()) return;
    if (!rubricOcrAsset?.uri) return;

    setIsOcring(true);
    setError(null);
    try {
      const fd = new FormData();
      const name =
        rubricOcrAsset.fileName?.trim() ||
        `rubric-${createdTask.id}-${Date.now()}.jpg`;
      const type = rubricOcrAsset.mimeType?.trim() || 'image/jpeg';
      fd.append('image', {
        uri: rubricOcrAsset.uri,
        name,
        type,
      } as unknown as Blob);

      const out = await organizerUploadJson<{
        text: string;
        criteria: string[];
      }>(`/organizer/tasks/${createdTask.id}/rubric-ocr`, organizerCode, fd);

      // Merge OCR criteria into existing list (dedupe, keep order).
      const incoming = Array.isArray(out?.criteria) ? out.criteria : [];
      setCriteria((prev) => {
        const seen = new Set(prev.map((x) => x.trim()).filter(Boolean));
        const next = [...prev];
        for (const c of incoming) {
          const v = String(c ?? '').trim();
          if (!v) continue;
          if (seen.has(v)) continue;
          seen.add(v);
          next.push(v);
        }
        return next.length ? next : [''];
      });
    } catch (e) {
      setError(toAppError(e).message ?? 'Rubric OCR failed.');
    } finally {
      setIsOcring(false);
    }
  }, [createdTask?.id, organizerCode, rubricOcrAsset]);

  const onSaveCriteria = useCallback(async () => {
    if (!createdTask?.id) return;
    if (!organizerCode.trim()) return;
    const cleaned = criteria.map((c) => c.trim()).filter(Boolean);
    setIsSavingCriteria(true);
    setError(null);
    try {
      const payload: { criteria: CriteriaIn[] } = {
        criteria: cleaned.map((v) => ({ criteria_type: 'rubric', value: v })),
      };
      await organizerJson(
        `/organizer/tasks/${createdTask.id}/criteria`,
        organizerCode,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
    } catch (e) {
      setError(toAppError(e).message ?? 'Failed to save rubric.');
    } finally {
      setIsSavingCriteria(false);
    }
  }, [createdTask?.id, criteria, organizerCode]);

  const [photoAsset, setPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photos, setPhotos] = useState<TaskPhoto[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const loadPhotos = useCallback(async () => {
    if (!createdTask?.id) return;
    if (!organizerCode.trim()) return;
    try {
      const rows = await organizerJson<TaskPhoto[]>(
        `/organizer/tasks/${createdTask.id}/photos`,
        organizerCode,
      );
      setPhotos(Array.isArray(rows) ? rows : []);
    } catch {
      // Non-blocking; uploads will refresh.
    }
  }, [createdTask?.id, organizerCode]);

  const onPickPhoto = useCallback(async () => {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo permission is required to pick an image.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.9,
    });
    if (res.canceled) return;
    setPhotoAsset(res.assets?.[0] ?? null);
  }, []);

  const onUploadPhoto = useCallback(async () => {
    if (!createdTask?.id) return;
    if (!organizerCode.trim()) return;
    if (!photoAsset?.uri) return;

    setIsUploadingPhoto(true);
    setError(null);
    try {
      const fd = new FormData();
      const name =
        photoAsset.fileName?.trim() ||
        `task-${createdTask.id}-${Date.now()}.jpg`;
      const type = photoAsset.mimeType?.trim() || 'image/jpeg';
      fd.append('photo', {
        uri: photoAsset.uri,
        name,
        type,
      } as unknown as Blob);

      await organizerUploadJson(
        `/organizer/tasks/${createdTask.id}/photos`,
        organizerCode,
        fd,
      );

      setPhotoAsset(null);
      await loadPhotos();
    } catch (e) {
      setError(toAppError(e).message ?? 'Photo upload failed.');
    } finally {
      setIsUploadingPhoto(false);
    }
  }, [createdTask?.id, loadPhotos, organizerCode, photoAsset]);

  const onGoToReview = useCallback(
    () => router.push('/(tabs)/organizer/review'),
    [],
  );
  const onGoToHistory = useCallback(
    () => router.push('/(tabs)/organizer/history'),
    [],
  );

  return (
    <SafeScreen backgroundColor={backgroundColor}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.navRow}>
          <Pressable
            onPress={() => {}}
            style={({ pressed }) => [
              styles.navPill,
              { borderColor: tint, backgroundColor: tint },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, styles.navActiveText]}>
              Create
            </Text>
          </Pressable>
          <Pressable
            onPress={onGoToReview}
            style={({ pressed }) => [
              styles.navPill,
              { borderColor: border },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Review
            </Text>
          </Pressable>
          <Pressable
            onPress={onGoToHistory}
            style={({ pressed }) => [
              styles.navPill,
              { borderColor: border },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              History
            </Text>
          </Pressable>
        </View>

        <Text style={[textStyles.title, { color: textColor }]}>
          Create task & Upload rubric
        </Text>

        <View style={styles.field}>
          <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
            Organizer code
          </Text>
          <TextInput
            value={organizerCode}
            onChangeText={setOrganizerCode}
            placeholder="Organizer code"
            placeholderTextColor={border}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!isCreating}
            style={[styles.input, { borderColor: border, color: colors.text }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
            Title
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Task title"
            placeholderTextColor={border}
            editable={!isCreating}
            style={[styles.input, { borderColor: border, color: colors.text }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
            Description (optional)
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What should participants do?"
            placeholderTextColor={border}
            editable={!isCreating}
            multiline
            style={[
              styles.textarea,
              { borderColor: border, color: colors.text },
            ]}
          />
        </View>

        <View style={styles.row}>
          <Pressable
            onPress={() => setTaskType('text')}
            style={({ pressed }) => [
              styles.choice,
              {
                borderColor: taskType === 'text' ? tint : border,
              },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Text
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTaskType('photo')}
            style={({ pressed }) => [
              styles.choice,
              {
                borderColor: taskType === 'photo' ? tint : border,
              },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Photo
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTaskType('combo')}
            style={({ pressed }) => [
              styles.choice,
              {
                borderColor: taskType === 'combo' ? tint : border,
              },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Combo
            </Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
            Max points
          </Text>
          <TextInput
            value={maxPoints}
            onChangeText={setMaxPoints}
            placeholder="10"
            placeholderTextColor={border}
            keyboardType="number-pad"
            editable={!isCreating}
            style={[styles.input, { borderColor: border, color: colors.text }]}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[textStyles.subtitle, { color: textColor }]}>
            Rubric (criteria)
          </Text>
          {!createdTask ? (
            <Text
              style={[textStyles.default, styles.hint, { color: textColor }]}
            >
              Create the task first to run OCR and save rubric.
            </Text>
          ) : null}
        </View>

        <View style={styles.row}>
          <Pressable
            onPress={onPickRubricImage}
            disabled={isOcring}
            style={({ pressed }) => [
              styles.button,
              { borderColor: tint },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
              Pick rubric image
            </Text>
          </Pressable>
          <Pressable
            onPress={onRunRubricOcr}
            disabled={!createdTask || !rubricOcrAsset || isOcring}
            style={({ pressed }) => [
              styles.button,
              {
                borderColor:
                  createdTask && rubricOcrAsset && !isOcring ? tint : border,
              },
              pressed && createdTask && rubricOcrAsset ? styles.pressed : null,
            ]}
          >
            <Text
              style={[
                textStyles.defaultSemiBold,
                {
                  color:
                    createdTask && rubricOcrAsset && !isOcring
                      ? tint
                      : textColor,
                },
              ]}
            >
              {isOcring ? 'Parsing…' : 'OCR rubric'}
            </Text>
          </Pressable>
          {isOcring ? <ActivityIndicator color={tint} /> : null}
        </View>
        {rubricOcrAsset ? (
          <Text style={[textStyles.default, styles.hint, { color: textColor }]}>
            Selected rubric image: {assetLabel(rubricOcrAsset)}
          </Text>
        ) : null}

        {criteria.map((c, idx) => (
          <View key={idx} style={styles.criteriaRow}>
            <TextInput
              value={c}
              onChangeText={(t) =>
                setCriteria((prev) => prev.map((p, i) => (i === idx ? t : p)))
              }
              placeholder={`Criterion ${idx + 1}`}
              placeholderTextColor={border}
              editable={!isSavingCriteria}
              style={[
                styles.input,
                { borderColor: border, color: colors.text, flex: 1 },
              ]}
            />
            <Pressable
              onPress={() =>
                setCriteria((prev) => prev.filter((_, i) => i !== idx))
              }
              disabled={criteria.length <= 1 || isSavingCriteria}
              style={({ pressed }) => [
                styles.smallButton,
                { borderColor: border },
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                −
              </Text>
            </Pressable>
          </View>
        ))}

        <View style={styles.row}>
          <Pressable
            onPress={() => setCriteria((prev) => [...prev, ''])}
            disabled={isSavingCriteria}
            style={({ pressed }) => [
              styles.button,
              { borderColor: tint },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
              Add criterion
            </Text>
          </Pressable>
          <Pressable
            onPress={onSaveCriteria}
            disabled={!createdTask || isSavingCriteria}
            style={({ pressed }) => [
              styles.button,
              { borderColor: createdTask ? tint : border },
              pressed && createdTask ? styles.pressed : null,
            ]}
          >
            <Text
              style={[
                textStyles.defaultSemiBold,
                { color: createdTask ? tint : textColor },
              ]}
            >
              {isSavingCriteria ? 'Saving…' : 'Save rubric'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={onCreateTask}
          disabled={!canCreate}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: canCreate ? tint : border },
            pressed && canCreate ? styles.pressed : null,
          ]}
        >
          <Text style={[textStyles.defaultSemiBold, styles.primaryText]}>
            {isCreating ? (createStep ?? 'Working…') : 'Create task'}
          </Text>
        </Pressable>

        {createdTask ? (
          <Text style={[textStyles.default, styles.hint, { color: textColor }]}>
            Created task ID:{' '}
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              {createdTask.id}
            </Text>
          </Text>
        ) : null}

        {createdTask ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[textStyles.subtitle, { color: textColor }]}>
                Photo references
              </Text>
            </View>

            <View style={styles.row}>
              <Pressable
                onPress={onPickPhoto}
                disabled={isUploadingPhoto}
                style={({ pressed }) => [
                  styles.button,
                  { borderColor: tint },
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                  Pick photo
                </Text>
              </Pressable>
              <Pressable
                onPress={onUploadPhoto}
                disabled={!photoAsset || isUploadingPhoto}
                style={({ pressed }) => [
                  styles.button,
                  { borderColor: photoAsset ? tint : border },
                  pressed && photoAsset ? styles.pressed : null,
                ]}
              >
                <Text
                  style={[
                    textStyles.defaultSemiBold,
                    { color: photoAsset ? tint : textColor },
                  ]}
                >
                  {isUploadingPhoto ? 'Uploading…' : 'Upload'}
                </Text>
              </Pressable>
              {isUploadingPhoto ? <ActivityIndicator color={tint} /> : null}
            </View>

            {photoAsset ? (
              <>
                <Text
                  style={[
                    textStyles.default,
                    styles.hint,
                    { color: textColor },
                  ]}
                >
                  Selected: {assetLabel(photoAsset)}
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
            ) : null}

            <Pressable
              onPress={loadPhotos}
              disabled={isUploadingPhoto}
              style={({ pressed }) => [
                styles.button,
                { borderColor: border },
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                Refresh photo list
              </Text>
            </Pressable>

            {photos.length ? (
              <View style={styles.photoGrid}>
                {photos.slice(0, 6).map((p) => (
                  <View key={p.id} style={styles.photoThumb}>
                    {p.signed_url ? (
                      <Image
                        source={{ uri: p.signed_url }}
                        style={styles.thumbImage}
                        contentFit="cover"
                        accessibilityLabel="Task reference photo"
                      />
                    ) : (
                      <View
                        style={[
                          styles.thumbPlaceholder,
                          { borderColor: border },
                        ]}
                      >
                        <Text
                          style={[
                            textStyles.default,
                            { color: textColor, opacity: 0.8 },
                          ]}
                        >
                          (no URL)
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <Text
                style={[textStyles.default, styles.hint, { color: textColor }]}
              >
                No reference photos uploaded yet.
              </Text>
            )}
          </>
        ) : null}

        {error ? (
          <Text style={[textStyles.default, styles.errorText, { color: tint }]}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10, paddingBottom: 24 },
  navRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  navPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  navActiveText: { color: 'white' },
  field: { gap: 6 },
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
    minHeight: 96,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  choice: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: 'white' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
  hint: { opacity: 0.85 },
  errorText: { opacity: 0.95 },
  sectionHeader: { marginTop: 12 },
  criteriaRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  smallButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 44,
    alignItems: 'center',
  },
  button: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  previewFrame: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  previewImage: { width: '100%', height: 220 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumb: { width: 100, height: 100, borderRadius: 14, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
