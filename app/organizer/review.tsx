import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';

import { screenStyles, textStyles, useAppTheme } from '@/lib/ui';
import { toAppError } from '@/lib/app-error';
import { organizerJson } from '@/lib/organizer-api';

type Submission = {
  id: string;
  task_id: string;
  team_id: string;
  text_answer: string | null;
  photo_url: string | null;
  status: string | null;
  score: number | null;
  confidence: number | null;
  rationale: string | null;
  gpt4o_description: string | null;
  created_at: string | null;
};

type ReviewQueueRow = {
  id: string;
  submission_id: string;
  claude_score: number | null;
  confidence: number | null;
  claude_rationale: string | null;
  created_at: string | null;
  submission?: Submission | null;
};

export default function OrganizerReviewDashboard() {
  const { colors, textColor, backgroundColor, tint, border } = useAppTheme();

  const [organizerCode, setOrganizerCode] = useState('');
  const [rows, setRows] = useState<ReviewQueueRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideScores, setOverrideScores] = useState<Record<string, string>>(
    {},
  );
  const [busyById, setBusyById] = useState<Record<string, boolean>>({});

  const canLoad = useMemo(() => Boolean(organizerCode.trim()), [organizerCode]);

  const loadQueue = useCallback(async () => {
    if (!organizerCode.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await organizerJson<ReviewQueueRow[]>(
        '/organizer/review-queue',
        organizerCode,
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(toAppError(e).message ?? 'Failed to load review queue.');
    } finally {
      setIsLoading(false);
    }
  }, [organizerCode]);

  useEffect(() => {
    // Don’t auto-fire without the code; wait for user input.
    setRows([]);
    setError(null);
  }, [organizerCode]);

  const setBusy = useCallback((id: string, v: boolean) => {
    setBusyById((prev) => ({ ...prev, [id]: v }));
  }, []);

  const onApprove = useCallback(
    async (row: ReviewQueueRow) => {
      if (!organizerCode.trim()) return;
      setBusy(row.id, true);
      setError(null);
      try {
        await organizerJson(
          `/organizer/review-queue/${row.id}/approve`,
          organizerCode,
          { method: 'POST' },
        );
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } catch (e) {
        setError(toAppError(e).message ?? 'Approve failed. Please try again.');
      } finally {
        setBusy(row.id, false);
      }
    },
    [organizerCode, setBusy],
  );

  const onOverride = useCallback(
    async (row: ReviewQueueRow) => {
      if (!organizerCode.trim()) return;
      const raw = (overrideScores[row.id] ?? '').trim();
      const score = Number(raw);
      if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0) {
        setError('Enter a valid non-negative whole number to override.');
        return;
      }

      setBusy(row.id, true);
      setError(null);
      try {
        await organizerJson(
          `/organizer/review-queue/${row.id}/override`,
          organizerCode,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ score }),
          },
        );
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } catch (e) {
        setError(toAppError(e).message ?? 'Override failed. Please try again.');
      } finally {
        setBusy(row.id, false);
      }
    },
    [organizerCode, overrideScores, setBusy],
  );

  const renderItem = useCallback(
    ({ item }: { item: ReviewQueueRow }) => {
      const s = item.submission ?? null;
      const content =
        (s?.gpt4o_description ?? '').trim() ||
        (s?.text_answer ?? '').trim() ||
        '(No submission content)';

      const busy = Boolean(busyById[item.id]);
      const suggested = item.claude_score;

      return (
        <View style={[styles.card, { borderColor: border }]}>
          <View style={styles.cardHeader}>
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Submission
            </Text>
            <Text
              style={[textStyles.default, styles.meta, { color: textColor }]}
            >
              Queue ID:{' '}
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                {item.id}
              </Text>
            </Text>
          </View>

          <Text style={[textStyles.default, styles.body, { color: textColor }]}>
            {content}
          </Text>

          <View style={styles.row}>
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Suggested score:
            </Text>
            <Text style={[textStyles.default, { color: textColor }]}>
              {suggested ?? '—'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Claude rationale:
            </Text>
          </View>
          <Text style={[textStyles.default, styles.body, { color: textColor }]}>
            {(item.claude_rationale ?? '').trim() || '—'}
          </Text>

          <View style={styles.actions}>
            <Pressable
              onPress={() => onApprove(item)}
              disabled={busy || suggested === null || suggested === undefined}
              style={({ pressed }) => [
                styles.button,
                { borderColor: tint },
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                Approve
              </Text>
            </Pressable>

            <View style={styles.overrideBox}>
              <TextInput
                value={overrideScores[item.id] ?? ''}
                onChangeText={(t) =>
                  setOverrideScores((prev) => ({ ...prev, [item.id]: t }))
                }
                placeholder="Custom score"
                placeholderTextColor={border}
                keyboardType="number-pad"
                editable={!busy}
                style={[
                  styles.input,
                  { borderColor: border, color: colors.text },
                ]}
              />
              <Pressable
                onPress={() => onOverride(item)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.button,
                  { borderColor: border },
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text
                  style={[textStyles.defaultSemiBold, { color: textColor }]}
                >
                  Override
                </Text>
              </Pressable>
            </View>

            {busy ? <ActivityIndicator color={tint} /> : null}
          </View>
        </View>
      );
    },
    [
      border,
      busyById,
      colors.text,
      onApprove,
      onOverride,
      overrideScores,
      textColor,
      tint,
    ],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Organizer Review' }} />
      <View style={[screenStyles.container, { backgroundColor }]}>
        <View style={styles.header}>
          <Text style={[textStyles.title, { color: textColor }]}>
            Review Queue
          </Text>
          <Text style={[textStyles.default, styles.hint, { color: textColor }]}>
            Enter organizer code to load flagged submissions.
          </Text>
        </View>

        <View style={styles.codeRow}>
          <TextInput
            value={organizerCode}
            onChangeText={setOrganizerCode}
            placeholder="Organizer code"
            placeholderTextColor={border}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[
              styles.codeInput,
              { borderColor: border, color: colors.text },
            ]}
          />
          <Pressable
            onPress={loadQueue}
            disabled={!canLoad || isLoading}
            style={({ pressed }) => [
              styles.loadButton,
              { backgroundColor: canLoad && !isLoading ? tint : border },
              pressed && canLoad && !isLoading ? styles.buttonPressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, styles.loadText]}>
              {isLoading ? 'Loading…' : 'Load'}
            </Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={[textStyles.default, styles.errorText, { color: tint }]}>
            {error}
          </Text>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={tint} />
            <Text
              style={[textStyles.default, styles.hint, { color: textColor }]}
            >
              Fetching review queue…
            </Text>
          </View>
        ) : rows.length === 0 && canLoad ? (
          <View style={styles.emptyBox}>
            <Text style={[textStyles.subtitle, { color: textColor }]}>
              Queue clear
            </Text>
            <Text
              style={[textStyles.default, styles.hint, { color: textColor }]}
            >
              No flagged submissions right now.
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshing={isLoading}
            onRefresh={loadQueue}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: 6, marginBottom: 12 },
  hint: { opacity: 0.85 },
  errorText: { marginTop: 8, opacity: 0.95 },
  codeRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  codeInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  loadButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  loadText: { color: 'white' },
  loadingBox: { marginTop: 18, gap: 10, alignItems: 'center' },
  emptyBox: { marginTop: 18, gap: 6, alignItems: 'center' },
  list: { paddingVertical: 12, gap: 12 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  meta: { opacity: 0.75 },
  body: { opacity: 0.95, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actions: {
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
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  overrideBox: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    minWidth: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
