import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  resetMockRoundScenario,
  rerunMockRedetect,
  runMockRoundScenario,
} from '../../application/services/roundDemoService';
import { useGameStore } from '../../application/stores/gameStore';
import { useRoundStore } from '../../application/stores/roundStore';
import { useVisionDebugStore } from '../../application/stores/visionDebugStore';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusCard } from '../components/StatusCard';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const toneForStatus = (status: string) => {
  switch (status) {
    case 'resultReady':
      return 'success' as const;
    case 'capturing':
      return 'info' as const;
    case 'error':
      return 'danger' as const;
    case 'ready':
      return 'warning' as const;
    default:
      return 'default' as const;
  }
};

export const GameScreen = ({ navigation }: Props) => {
  const [isRunning, setIsRunning] = useState(false);
  const { selectedMode, players } = useGameStore();
  const { status, statusMessage, throws } = useRoundStore();
  const artifactCount = useVisionDebugStore(state => state.artifacts.length);

  const totalScore = useMemo(
    () => throws.reduce((sum, item) => sum + item.score, 0),
    [throws],
  );

  const handleRunMockRound = async () => {
    setIsRunning(true);
    try {
      await runMockRoundScenario();
    } finally {
      setIsRunning(false);
    }
  };

  const handleMockRedetect = async () => {
    setIsRunning(true);
    try {
      await rerunMockRedetect();
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunMockRoundPress = () => {
    handleRunMockRound().catch(() => undefined);
  };

  const handleMockRedetectPress = () => {
    handleMockRedetect().catch(() => undefined);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Game Shell"
        title="Round flow placeholder"
        description="This screen defines the UI contract for the future Android Native bridge. Current actions run against a mock service."
      />

      <View style={styles.statusGrid}>
        <StatusCard label="Mode" value={selectedMode} />
        <StatusCard
          label="Round Status"
          value={status}
          tone={toneForStatus(status)}
        />
        <StatusCard label="Artifacts" value={`${artifactCount}`} />
      </View>

      <Panel>
        <Text style={styles.panelTitle}>Phase-one notes</Text>
        <Text style={styles.body}>
          `react-native-vision-camera` is reserved for the Android camera path,
          but the preview and frame pipeline remain native-integration work for
          phase two.
        </Text>
        <Text style={styles.statusMessage}>{statusMessage}</Text>
      </Panel>

      <Panel>
        <Text style={styles.panelTitle}>Players</Text>
        {players.map(player => (
          <View key={player.id} style={styles.rowBetween}>
            <Text style={styles.bodyStrong}>{player.name}</Text>
            <Text style={styles.body}>{player.score}</Text>
          </View>
        ))}
      </Panel>

      <Panel>
        <Text style={styles.panelTitle}>Latest mock result</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.bodyStrong}>Total score</Text>
          <Text style={styles.totalScore}>{totalScore}</Text>
        </View>
        {throws.length === 0 ? (
          <Text style={styles.body}>No round result yet.</Text>
        ) : (
          throws.map(item => (
            <View key={item.id} style={styles.throwRow}>
              <View>
                <Text style={styles.bodyStrong}>{item.label}</Text>
                <Text style={styles.body}>
                  ({item.pointNorm.x.toFixed(2)}, {item.pointNorm.y.toFixed(2)})
                </Text>
              </View>
              <Text style={styles.throwScore}>{item.score}</Text>
            </View>
          ))
        )}
      </Panel>

      <View style={styles.actionGroup}>
        <PrimaryButton
          label={isRunning ? 'Running Mock Round...' : 'Run Mock Round'}
          onPress={handleRunMockRoundPress}
        />
        <SecondaryButton
          label={isRunning ? 'Redetecting...' : 'Run Mock Redetect'}
          onPress={handleMockRedetectPress}
        />
        <SecondaryButton
          label="Open Debug Screen"
          onPress={() => navigation.navigate('Debug')}
        />
        <SecondaryButton
          label="Reset Demo State"
          onPress={resetMockRoundScenario}
        />
      </View>
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
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.info,
  },
  totalScore: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.accent,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  throwRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  throwScore: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  actionGroup: {
    gap: 12,
  },
});
