import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack } from 'expo-router';

import { SafeScreen } from '@/components/safe-screen';
import { toAppError } from '@/lib/app-error';
import { organizerJson } from '@/lib/organizer-api';
import { useRole } from '@/lib/role-context';
import { textStyles, useAppTheme } from '@/lib/ui';

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

type ReviewHistoryRow = {
  id: string;
  queue_id: string | null;
  submission_id: string;
  decision: 'approve' | 'override' | string;
  final_score: number | null;
  final_rationale: string | null;
  suggested_score: number | null;
  suggested_rationale: string | null;
  created_at: string | null;
  submission?: Submission | null;
};

export default function OrganizerHistoryScreen() {
  const { colors, textColor, backgroundColor, tint, border } = useAppTheme();
  const {
    role,
    organizerCode: sessionOrganizerCode,
    setOrganizerCode: setSessionOrganizerCode,
    setRole,
  } = useRole();

  const [organizerCode, setOrganizerCode] = useState('');
  const [rows, setRows] = useState<ReviewHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLoad = useMemo(() => Boolean(organizerCode.trim()), [organizerCode]);
  const didPrefillOrganizerCodeRef = useRef(false);
  const didAutoLoadRef = useRef(false);

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

  const loadHistory = useCallback(async () => {
    if (!organizerCode.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await organizerJson<ReviewHistoryRow[]>(
        '/organizer/review-history?limit=100',
        organizerCode,
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(toAppError(e).message ?? 'Failed to load review history.');
    } finally {
      setIsLoading(false);
    }
  }, [organizerCode]);

  useEffect(() => {
    setRows([]);
    setError(null);
  }, [organizerCode]);

  useEffect(() => {
    if (!didAutoLoadRef.current && canLoad) {
      didAutoLoadRef.current = true;
      loadHistory().catch(() => {});
    }
  }, [canLoad, loadHistory]);

  const onGoToCreate = useCallback(
    () => router.push('/organizer/create-task'),
    [],
  );
  const onGoToReview = useCallback(() => router.push('/organizer/review'), []);

  const renderItem = useCallback(
    ({ item }: { item: ReviewHistoryRow }) => {
      const s = item.submission ?? null;
      const content =
        (s?.gpt4o_description ?? '').trim() ||
        (s?.text_answer ?? '').trim() ||
        '(No submission content)';

      return (
        <View style={[styles.card, { borderColor: border }]}>
          <View style={styles.cardHeader}>
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              {String(item.decision || 'decision').toUpperCase()}
            </Text>
            <Text
              style={[textStyles.default, styles.meta, { color: textColor }]}
            >
              Submission:{' '}
              <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                {item.submission_id}
              </Text>
            </Text>
          </View>

          <Text style={[textStyles.default, styles.body, { color: textColor }]}>
            {content}
          </Text>

          <View style={styles.row}>
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Final score:
            </Text>
            <Text style={[textStyles.default, { color: textColor }]}>
              {item.final_score ?? '—'}
            </Text>
          </View>
          <Text style={[textStyles.default, styles.body, { color: textColor }]}>
            {(item.final_rationale ?? '').trim() || '—'}
          </Text>

          <View style={styles.row}>
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
              Suggested:
            </Text>
            <Text style={[textStyles.default, { color: textColor }]}>
              {item.suggested_score ?? '—'}
            </Text>
          </View>
        </View>
      );
    },
    [border, textColor],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Organizer History' }} />
      <SafeScreen backgroundColor={backgroundColor}>
        <View style={styles.navRow}>
          <Pressable
            onPress={onGoToCreate}
            style={({ pressed }) => [
              styles.navPill,
              { borderColor: border },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
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
            onPress={() => {}}
            style={({ pressed }) => [
              styles.navPill,
              { borderColor: tint, backgroundColor: tint },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[textStyles.defaultSemiBold, styles.navActiveText]}>
              History
            </Text>
          </Pressable>
        </View>

        <View style={styles.header}>
          <Text style={[textStyles.title, { color: textColor }]}>History</Text>
          <Text style={[textStyles.default, styles.hint, { color: textColor }]}>
            Decisions made by organizers (approve/override).
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
            onPress={loadHistory}
            disabled={!canLoad || isLoading}
            style={({ pressed }) => [
              styles.loadButton,
              { backgroundColor: canLoad && !isLoading ? tint : border },
              pressed && canLoad && !isLoading ? styles.pressed : null,
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
              Fetching history…
            </Text>
          </View>
        ) : rows.length === 0 && canLoad ? (
          <View style={styles.emptyBox}>
            <Text style={[textStyles.subtitle, { color: textColor }]}>
              No history yet
            </Text>
            <Text
              style={[textStyles.default, styles.hint, { color: textColor }]}
            >
              Approve/override something to populate this.
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshing={isLoading}
            onRefresh={loadHistory}
          />
        )}
      </SafeScreen>
    </>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
  navPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  navActiveText: { color: 'white' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
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
});
