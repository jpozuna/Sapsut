import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
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
} from '@/components/ui';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Radius, Spacing } from '@/constants/theme';
import { toAppError } from '@/lib/app-error';
import { organizerJson } from '@/lib/organizer-api';
import { organizerUploadJson } from '@/lib/organizer-upload';
import { useRole } from '@/lib/role-context';
import { useAppTheme } from '@/lib/ui';

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

type TaskType = 'text' | 'photo' | 'combo';

const TASK_TYPES: {
  value: TaskType;
  label: string;
  icon: IconSymbolName;
}[] = [
  { value: 'text', label: 'Text', icon: 'text.alignleft' },
  { value: 'photo', label: 'Photo', icon: 'camera.fill' },
  { value: 'combo', label: 'Both', icon: 'photo.on.rectangle' },
];

function assetLabel(asset: ImagePicker.ImagePickerAsset): string {
  return (
    asset.fileName?.trim() ||
    asset.uri?.split('?')[0]?.split('#')[0]?.split('/').pop()?.trim() ||
    'selected photo'
  );
}

function Section({
  label,
  children,
  index = 0,
}: {
  label: string;
  children: React.ReactNode;
  index?: number;
}) {
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(280)}
      style={styles.section}
    >
      <AppText variant="overline" tone="tertiary">
        {label}
      </AppText>
      <AppCard>{children}</AppCard>
    </Animated.View>
  );
}

export default function OrganizerCreateTaskScreen() {
  const { taskId: editTaskIdParam } = useLocalSearchParams<{
    taskId?: string;
  }>();
  const { colors } = useAppTheme();
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
  const [taskType, setTaskType] = useState<TaskType>('combo');
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
  const onGoToTeams = useCallback(
    () => router.push('/(tabs)/organizer/teams'),
    [],
  );

  const isEditing = Boolean(createdTask);
  const pointsValue = Number(maxPoints.trim());
  const pointsError =
    maxPoints.trim().length > 0 &&
    (!Number.isFinite(pointsValue) || pointsValue < 0)
      ? 'Enter a whole number of points (0 or more).'
      : undefined;

  const navItems: { label: string; onPress?: () => void; active: boolean }[] = [
    { label: 'Create', active: true },
    { label: 'Review', onPress: onGoToReview, active: false },
    { label: 'History', onPress: onGoToHistory, active: false },
    { label: 'Teams', onPress: onGoToTeams, active: false },
  ];

  const canOcr = Boolean(createdTask && rubricOcrAsset && !isOcring);

  return (
    <SafeScreen>
      <NavBar
        title={isEditing ? 'Edit task' : 'New task'}
        rightSlot={
          isEditing ? (
            <AppChip tone="accent">Editing</AppChip>
          ) : (
            <AppChip tone="neutral">Draft</AppChip>
          )
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.navRow}>
            {navItems.map((item) => (
              <Pressable
                key={item.label}
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityState={{ selected: item.active }}
                style={[
                  styles.navPill,
                  {
                    backgroundColor: item.active
                      ? colors.accent
                      : colors.surfaceSunken,
                  },
                ]}
              >
                <AppText
                  variant="label"
                  style={{
                    color: item.active ? colors.onAccent : colors.textSecondary,
                  }}
                >
                  {item.label}
                </AppText>
              </Pressable>
            ))}
          </View>

          <AppText variant="heading" style={styles.pageTitle}>
            {isEditing ? 'Update this hunt task' : 'Author a hunt task'}
          </AppText>
          <AppText variant="callout" tone="secondary" style={styles.pageLead}>
            Describe the task, choose how teams submit it, and give the AI a
            rubric to grade against.
          </AppText>

          {error ? (
            <View
              style={[styles.banner, { backgroundColor: colors.dangerSoft }]}
            >
              <IconSymbol
                name="exclamationmark.triangle.fill"
                size={16}
                color={colors.danger}
              />
              <AppText
                variant="callout"
                style={[styles.bannerText, { color: colors.onDangerSoft }]}
              >
                {error}
              </AppText>
            </View>
          ) : null}

          <Section label="Access" index={0}>
            <AppInput
              label="Organizer code"
              hint="Required to create or edit tasks."
              value={organizerCode}
              onChangeText={setOrganizerCode}
              placeholder="Enter your organizer code"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!isCreating}
            />
          </Section>

          <Section label="Details" index={1}>
            <View style={styles.stack}>
              <AppInput
                label="Title"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Find the Husky statue"
                editable={!isCreating}
              />
              <AppInput
                label="Description"
                hint="Optional. What should participants do?"
                value={description}
                onChangeText={setDescription}
                placeholder="Give teams the full instructions…"
                editable={!isCreating}
                multiline
              />
            </View>
          </Section>

          <Section label="Submission type" index={2}>
            <AppText variant="callout" tone="secondary">
              How should teams answer this task?
            </AppText>
            <View
              style={[
                styles.segmented,
                { backgroundColor: colors.surfaceSunken },
              ]}
            >
              {TASK_TYPES.map((option) => {
                const active = taskType === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setTaskType(option.value)}
                    disabled={isCreating}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${option.label} submission`}
                    style={[
                      styles.segment,
                      active ? { backgroundColor: colors.accent } : null,
                    ]}
                  >
                    <IconSymbol
                      name={option.icon}
                      size={15}
                      color={active ? colors.onAccent : colors.textSecondary}
                    />
                    <AppText
                      variant="label"
                      style={{
                        color: active ? colors.onAccent : colors.textSecondary,
                      }}
                    >
                      {option.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section label="Scoring" index={3}>
            <AppInput
              label="Max points"
              hint="Whole number awarded for a fully correct submission."
              value={maxPoints}
              onChangeText={setMaxPoints}
              placeholder="10"
              keyboardType="number-pad"
              editable={!isCreating}
              error={pointsError}
            />
          </Section>

          <Section label="Rubric" index={4}>
            <View style={styles.stack}>
              <View>
                <AppText variant="title">Judging criteria</AppText>
                <AppText
                  variant="callout"
                  tone="secondary"
                  style={styles.sectionLead}
                >
                  {createdTask
                    ? 'Upload a photo of a printed rubric to extract criteria, or write them by hand.'
                    : 'Attach a rubric photo now — it is parsed automatically once the task is created.'}
                </AppText>
              </View>

              <Pressable
                onPress={onPickRubricImage}
                disabled={isOcring}
                accessibilityRole="button"
                accessibilityLabel="Pick rubric image"
                style={[
                  styles.dropzone,
                  {
                    borderColor: rubricOcrAsset
                      ? colors.accent
                      : colors.borderStrong,
                    backgroundColor: colors.surfaceSunken,
                  },
                ]}
              >
                {rubricOcrAsset ? (
                  <View style={styles.dropzoneFilled}>
                    <Image
                      source={{ uri: rubricOcrAsset.uri }}
                      style={styles.rubricPreview}
                      contentFit="cover"
                      accessibilityLabel="Selected rubric image preview"
                    />
                    <View style={styles.dropzoneMeta}>
                      <AppText variant="label" numberOfLines={1}>
                        {assetLabel(rubricOcrAsset)}
                      </AppText>
                      <AppText variant="caption" tone="tertiary">
                        Tap to replace
                      </AppText>
                    </View>
                  </View>
                ) : (
                  <View style={styles.dropzoneEmpty}>
                    <View
                      style={[
                        styles.dropzoneIcon,
                        { backgroundColor: colors.accentSoft },
                      ]}
                    >
                      <IconSymbol
                        name="photo.badge.plus"
                        size={20}
                        color={colors.accent}
                      />
                    </View>
                    <AppText variant="bodyStrong">Upload rubric photo</AppText>
                    <AppText variant="caption" tone="tertiary" align="center">
                      A printed rubric is scanned into criteria automatically.
                    </AppText>
                  </View>
                )}
              </Pressable>

              <View style={styles.buttonRow}>
                <AppButton
                  tone="secondary"
                  size="sm"
                  onPress={onRunRubricOcr}
                  disabled={!canOcr}
                  loading={isOcring}
                >
                  {isOcring ? 'Parsing…' : 'Scan rubric'}
                </AppButton>
                {!createdTask ? (
                  <AppText
                    variant="caption"
                    tone="tertiary"
                    style={styles.flex}
                  >
                    Create the task first to scan and save the rubric.
                  </AppText>
                ) : null}
              </View>

              <View style={styles.stack}>
                {criteria.map((c, idx) => (
                  <View key={idx} style={styles.criteriaRow}>
                    <AppInput
                      containerStyle={styles.flex}
                      value={c}
                      onChangeText={(t) =>
                        setCriteria((prev) =>
                          prev.map((p, i) => (i === idx ? t : p)),
                        )
                      }
                      placeholder={`Criterion ${idx + 1}`}
                      editable={!isSavingCriteria}
                      multiline
                      style={styles.criteriaInput}
                    />
                    <Pressable
                      onPress={() =>
                        setCriteria((prev) => prev.filter((_, i) => i !== idx))
                      }
                      disabled={criteria.length <= 1 || isSavingCriteria}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove criterion ${idx + 1}`}
                      style={[
                        styles.iconButton,
                        {
                          backgroundColor: colors.surfaceSunken,
                          opacity:
                            criteria.length <= 1 || isSavingCriteria ? 0.4 : 1,
                        },
                      ]}
                    >
                      <IconSymbol
                        name="trash"
                        size={16}
                        color={colors.danger}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>

              <View style={styles.buttonRow}>
                <AppButton
                  tone="secondary"
                  size="sm"
                  onPress={() => setCriteria((prev) => [...prev, ''])}
                  disabled={isSavingCriteria}
                  icon={
                    <IconSymbol
                      name="plus"
                      size={14}
                      color={colors.textPrimary}
                    />
                  }
                >
                  Add criterion
                </AppButton>
                <AppButton
                  tone="ghost"
                  size="sm"
                  onPress={onSaveCriteria}
                  disabled={!createdTask || isSavingCriteria}
                  loading={isSavingCriteria}
                >
                  {isSavingCriteria ? 'Saving…' : 'Save rubric'}
                </AppButton>
              </View>
            </View>
          </Section>

          {createdTask ? (
            <Section label="Reference photos" index={5}>
              <View style={styles.stack}>
                <View>
                  <AppText variant="title">Examples for graders</AppText>
                  <AppText
                    variant="callout"
                    tone="secondary"
                    style={styles.sectionLead}
                  >
                    Optional reference shots stored alongside this task.
                  </AppText>
                </View>

                <Pressable
                  onPress={onPickPhoto}
                  disabled={isUploadingPhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Pick reference photo"
                  style={[
                    styles.dropzone,
                    {
                      borderColor: photoAsset
                        ? colors.accent
                        : colors.borderStrong,
                      backgroundColor: colors.surfaceSunken,
                    },
                  ]}
                >
                  {photoAsset ? (
                    <View style={styles.dropzoneFilled}>
                      <Image
                        source={{ uri: photoAsset.uri }}
                        style={styles.rubricPreview}
                        contentFit="cover"
                        accessibilityLabel="Selected photo preview"
                      />
                      <View style={styles.dropzoneMeta}>
                        <AppText variant="label" numberOfLines={1}>
                          {assetLabel(photoAsset)}
                        </AppText>
                        <AppText variant="caption" tone="tertiary">
                          Tap to replace
                        </AppText>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.dropzoneEmpty}>
                      <View
                        style={[
                          styles.dropzoneIcon,
                          { backgroundColor: colors.accentSoft },
                        ]}
                      >
                        <IconSymbol
                          name="photo.badge.plus"
                          size={20}
                          color={colors.accent}
                        />
                      </View>
                      <AppText variant="bodyStrong">Add a photo</AppText>
                    </View>
                  )}
                </Pressable>

                <View style={styles.buttonRow}>
                  <AppButton
                    tone="secondary"
                    size="sm"
                    onPress={onUploadPhoto}
                    disabled={!photoAsset || isUploadingPhoto}
                    loading={isUploadingPhoto}
                  >
                    {isUploadingPhoto ? 'Uploading…' : 'Upload'}
                  </AppButton>
                  <AppButton
                    tone="ghost"
                    size="sm"
                    onPress={loadPhotos}
                    disabled={isUploadingPhoto}
                    icon={
                      <IconSymbol
                        name="arrow.clockwise"
                        size={14}
                        color={colors.accent}
                      />
                    }
                  >
                    Refresh
                  </AppButton>
                </View>

                {photos.length ? (
                  <View style={styles.photoGrid}>
                    {photos.slice(0, 6).map((p) => (
                      <View
                        key={p.id}
                        style={[
                          styles.photoThumb,
                          { backgroundColor: colors.surfaceSunken },
                        ]}
                      >
                        {p.signed_url ? (
                          <Image
                            source={{ uri: p.signed_url }}
                            style={styles.thumbImage}
                            contentFit="cover"
                            accessibilityLabel="Task reference photo"
                          />
                        ) : (
                          <View style={styles.thumbPlaceholder}>
                            <IconSymbol
                              name="photo"
                              size={18}
                              color={colors.textTertiary}
                            />
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                ) : (
                  <AppText variant="caption" tone="tertiary">
                    No reference photos uploaded yet.
                  </AppText>
                )}

                <View style={styles.idRow}>
                  <AppText variant="caption" tone="tertiary">
                    Task ID
                  </AppText>
                  <AppText variant="caption" tone="secondary" numberOfLines={1}>
                    {createdTask.id}
                  </AppText>
                </View>
              </View>
            </Section>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: colors.canvas,
              borderTopColor: colors.border,
            },
          ]}
        >
          {isCreating && createStep ? (
            <AppText
              variant="caption"
              tone="tertiary"
              align="center"
              style={styles.footerStep}
            >
              {createStep}
            </AppText>
          ) : null}
          <AppButton
            fullWidth
            size="lg"
            onPress={onCreateTask}
            disabled={!canCreate}
            loading={isCreating}
          >
            {isEditing ? 'Save changes' : 'Create task'}
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
    paddingBottom: Spacing.xl,
  },
  navRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  navPill: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  pageTitle: {
    marginBottom: Spacing.xs,
  },
  pageLead: {
    marginBottom: Spacing.lg,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    marginBottom: Spacing.lg,
  },
  bannerText: {
    flex: 1,
  },
  section: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  stack: {
    gap: Spacing.base,
  },
  sectionLead: {
    marginTop: Spacing.xs,
  },
  segmented: {
    flexDirection: 'row',
    gap: Spacing.xs,
    padding: Spacing.xs,
    borderRadius: Radius.pill,
    marginTop: Spacing.md,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs + 2,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.pill,
  },
  dropzone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    padding: Spacing.base,
  },
  dropzoneEmpty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  dropzoneIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropzoneFilled: {
    gap: Spacing.md,
  },
  dropzoneMeta: {
    gap: Spacing.xxs,
  },
  rubricPreview: {
    width: '100%',
    height: 180,
    borderRadius: Radius.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  criteriaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  criteriaInput: {
    minHeight: 50,
  },
  iconButton: {
    width: 50,
    height: 50,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  photoThumb: {
    width: 92,
    height: 92,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  footer: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  footerStep: {
    marginBottom: Spacing.xxs,
  },
});
