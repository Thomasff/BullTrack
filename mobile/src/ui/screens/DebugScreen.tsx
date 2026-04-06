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
import { isRealBullTrackNativeBridgeAvailable } from '../../native-bridge/bulltrack/bullTrackNative';

type Props = NativeStackScreenProps<RootStackParamList, 'Debug'>;

export const DebugScreen = ({ navigation }: Props) => {
  const artifacts = useVisionDebugStore(state => state.artifacts);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Debug Shell"
        title="Debug artifact contract"
        description="Phase two keeps debug artifacts as file-path-first records so JS never becomes the transport layer for image bytes."
      />

      <Panel>
        <Text style={styles.panelTitle}>Current strategy</Text>
        <Text style={styles.body}>
          {isRealBullTrackNativeBridgeAvailable
            ? 'Native writes debug images into app-private storage and returns file references. The UI only renders metadata and local file paths.'
            : 'The native bridge is unavailable in this runtime, so this screen only shows mock file references.'}
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
