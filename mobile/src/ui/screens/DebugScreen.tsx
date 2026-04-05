import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useVisionDebugStore } from '../../application/stores/visionDebugStore';
import { DebugImageViewer } from '../components/DebugImageViewer';
import { Panel } from '../components/Panel';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Debug'>;

export const DebugScreen = ({ navigation }: Props) => {
  const artifacts = useVisionDebugStore(state => state.artifacts);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Debug Shell"
        title="Debug artifact contract"
        description="Phase one keeps debug artifacts as file-path-first records so JS never becomes the transport layer for image bytes."
      />

      <Panel>
        <Text style={styles.panelTitle}>Current strategy</Text>
        <Text style={styles.body}>
          Native should write debug images to disk and return paths or
          identifiers. The UI only renders metadata and file references.
        </Text>
      </Panel>

      {artifacts.length === 0 ? (
        <Panel>
          <Text style={styles.panelTitle}>No artifacts yet</Text>
          <Text style={styles.body}>
            Start a mock round from the game screen to populate placeholder
            artifacts.
          </Text>
        </Panel>
      ) : (
        <View style={styles.list}>
          {artifacts.map(artifact => (
            <DebugImageViewer key={artifact.id} artifact={artifact} />
          ))}
        </View>
      )}

      <SecondaryButton
        label="Back to Home"
        onPress={() => navigation.navigate('Home')}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    gap: 20,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  list: {
    gap: 12,
  },
});
