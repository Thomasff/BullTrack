import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CONTROLLED_START_FRAME,
  finishControlledRound,
  reloadControlledArtifacts,
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
import { isRealBullTrackNativeBridgeAvailable } from '../../native-bridge/bulltrack/bullTrackNative';

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
  const [runningAction, setRunningAction] = useState<
    'start' | 'redetect' | 'finish' | 'reload' | null
  >(null);
  const { selectedMode, players } = useGameStore();
  const { status, statusMessage, throws } = useRoundStore();
  const artifactCount = useVisionDebugStore(state => state.artifacts.length);

  const isRunning = runningAction !== null;
  const totalScore = useMemo(
    () => throws.reduce((sum, item) => sum + item.score, 0),
    [throws],
  );

  const handleRunMockRound = async () => {
    setRunningAction('start');
    try {
      await runMockRoundScenario();
    } finally {
      setRunningAction(null);
    }
  };

  const handleMockRedetect = async () => {
    setRunningAction('redetect');
    try {
      await rerunMockRedetect();
    } finally {
      setRunningAction(null);
    }
  };

  const handleRunMockRoundPress = () => {
    handleRunMockRound().catch(() => undefined);
  };

  const handleMockRedetectPress = () => {
    handleMockRedetect().catch(() => undefined);
  };

  const handleFinishRound = async () => {
    setRunningAction('finish');
    try {
      await finishControlledRound();
    } finally {
      setRunningAction(null);
    }
  };

  const handleReloadArtifacts = async () => {
    setRunningAction('reload');
    try {
      await reloadControlledArtifacts();
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Game Shell"
        title="Single-frame controlled detect"
        description="This screen runs startRound with before.jpg only, to verify board baseline detection and failure reporting without continuous frame flow."
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
        <Text style={styles.panelTitle}>Phase-two controlled bridge</Text>
        <Text style={styles.body}>
          {isRealBullTrackNativeBridgeAvailable
            ? 'The Android TurboModule is active. This screen validates the real detection bridge with bundled asset frames before the live camera path is migrated.'
            : 'The Android TurboModule is not available in this runtime, so the screen has fallen back to the mock bridge.'}
        </Text>
        <Text style={styles.body}>Start frame: {CONTROLLED_START_FRAME}</Text>
        <Text style={styles.body}>
          Process/redetect: disabled in single-frame mode
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
          label={
            runningAction === 'start'
              ? 'Starting Controlled Round...'
              : 'Start Controlled Round'
          }
          onPress={handleRunMockRoundPress}
          disabled={isRunning}
        />
        <SecondaryButton
          label={
            runningAction === 'redetect'
              ? 'Redetecting...'
              : 'Run Controlled Redetect (Disabled)'
          }
          onPress={handleMockRedetectPress}
          disabled={isRunning}
        />
        <SecondaryButton
          label={
            runningAction === 'finish'
              ? 'Finishing Round...'
              : 'Finish Current Round'
          }
          onPress={() => {
            handleFinishRound().catch(() => undefined);
          }}
          disabled={isRunning}
        />
        <SecondaryButton
          label={
            runningAction === 'reload'
              ? 'Reloading Artifacts...'
              : 'Reload Debug Artifacts'
          }
          onPress={() => {
            handleReloadArtifacts().catch(() => undefined);
          }}
          disabled={isRunning}
        />
        <SecondaryButton
          label="Open Debug Screen"
          onPress={() => navigation.navigate('Debug')}
          disabled={isRunning}
        />
        <SecondaryButton
          label="Reset Demo State"
          onPress={resetMockRoundScenario}
          disabled={isRunning}
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
