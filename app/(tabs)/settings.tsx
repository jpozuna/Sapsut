import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { ScreenState } from '@/components/screen-state';
import { screenStyles, textStyles, useAppTheme } from '@/lib/ui';
import { useRole } from '@/lib/role-context';

export default function SettingsScreen() {
  const { textColor, backgroundColor, tint, border, colors } = useAppTheme();

  const { role, enterOrganizerMode, exitOrganizerMode } = useRole();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const modeLabel = useMemo(() => {
    return role === 'organizer' ? 'Organizer' : 'Participant';
  }, [role]);

  const openOrganizerPrompt = useCallback(() => {
    setError(null);
    setCodeDraft('');
    setIsModalOpen(true);
  }, []);

  const onConfirmOrganizer = useCallback(() => {
    const code = codeDraft.trim();
    if (!code) {
      setError('Enter an organizer code.');
      return;
    }
    setIsModalOpen(false);
    setError(null);
    enterOrganizerMode(code);
    router.push('/organizer/review');
  }, [codeDraft, enterOrganizerMode]);

  const onCancelOrganizer = useCallback(() => {
    setIsModalOpen(false);
    setError(null);
  }, []);

  const onSwitchToParticipant = useCallback(() => {
    exitOrganizerMode();
    router.replace('/(tabs)');
  }, [exitOrganizerMode]);

  return (
    <ScreenState isLoading={false}>
      <View style={[screenStyles.container, styles.container, { backgroundColor }]}>
        <View style={styles.header}>
          <Text style={[textStyles.title, { color: textColor }]}>Settings</Text>
          <Text style={[textStyles.default, styles.subtitle, { color: textColor }]}>
            Current mode: {modeLabel}
          </Text>
        </View>

        <View style={[styles.card, { borderColor: border }]}>
          <Text style={[textStyles.subtitle, { color: textColor }]}>Role</Text>
          <Text style={[textStyles.default, styles.hint, { color: textColor }]}>
            Switch between participant views and organizer tools.
          </Text>

          {role === 'participant' ? (
            <Pressable
              onPress={openOrganizerPrompt}
              style={({ pressed }) => [
                styles.primaryButton,
                { borderColor: tint },
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                Switch to Organizer
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onSwitchToParticipant}
              style={({ pressed }) => [
                styles.primaryButton,
                { borderColor: tint },
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={[textStyles.defaultSemiBold, { color: tint }]}>
                Switch to Participant
              </Text>
            </Pressable>
          )}
        </View>

        <Modal
          visible={isModalOpen}
          transparent
          animationType="fade"
          onRequestClose={onCancelOrganizer}
        >
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalCard,
                { borderColor: border, backgroundColor },
              ]}
            >
              <Text style={[textStyles.subtitle, { color: textColor }]}>
                Enter organizer code
              </Text>
              <Text style={[textStyles.default, styles.hint, { color: textColor }]}>
                This stays in memory for this session only.
              </Text>

              <TextInput
                value={codeDraft}
                onChangeText={(t) => {
                  setCodeDraft(t);
                  if (error) setError(null);
                }}
                placeholder="Organizer code"
                placeholderTextColor={border}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[
                  styles.input,
                  { borderColor: border, color: colors.text },
                ]}
              />

              {error ? (
                <Text style={[textStyles.default, styles.errorText, { color: tint }]}>
                  {error}
                </Text>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable
                  onPress={onCancelOrganizer}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: border },
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={[textStyles.defaultSemiBold, { color: textColor }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onConfirmOrganizer}
                  style={({ pressed }) => [
                    styles.primaryButtonFilled,
                    { backgroundColor: tint },
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={[textStyles.defaultSemiBold, { color: 'white' }]}>
                    Continue
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  header: { gap: 6 },
  subtitle: { opacity: 0.85 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  hint: { opacity: 0.85, lineHeight: 20 },
  primaryButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  primaryButtonFilled: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  errorText: { opacity: 0.95 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
});

