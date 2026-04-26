import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function TaskSubmitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Submit' }} />
      <ThemedView style={styles.container}>
        <View style={styles.content}>
          <ThemedText type="title">Submission</ThemedText>
          <ThemedText style={styles.hint}>
            Submission form coming next. Task id:
          </ThemedText>
          <ThemedText type="defaultSemiBold">{String(id ?? '')}</ThemedText>
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
  hint: {
    opacity: 0.85,
  },
});
