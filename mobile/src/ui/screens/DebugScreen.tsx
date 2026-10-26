import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useGameStore } from '../../application/stores/gameStore';
import { bullTrackNativeBridge } from '../../native-bridge/bulltrack/bullTrackNative';
import type { DebugRoundSummary } from '../../native-bridge/bulltrack/types';
import type { DebugArtifact } from '../../domain/vision/types';
import { DebugImageViewer } from '../components/DebugImageViewer';
import { DartBoard } from '../components/DartBoard';
import { throwAt } from '../../domain/game/boardGeometry';
import type { ThrowResult } from '../../domain/game/types';
import { Panel } from '../components/Panel';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Debug'>;

// Sample darts so the board and drag correction can be checked without a real round.
const sampleThrows = (): ThrowResult[] => [
  throwAt({ x: 0.02, y: -0.52 }, 'sample-1'),
  throwAt({ x: 0.3, y: 0.25 }, 'sample-2'),
  throwAt({ x: -0.05, y: 0.08 }, 'sample-3'),
];

const pad = (value: number) => `${value}`.padStart(2, '0');

const roundLabel = (round: DebugRoundSummary, currentRoundId: string | null) => {
  const time = new Date(round.savedAt);
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
  return round.roundId === currentRoundId ? `${clock}（本轮）` : clock;
};

export const DebugScreen = ({ navigation }: Props) => {
  const currentRoundId = useGameStore(state => state.roundId);
  const [boardThrows, setBoardThrows] = useState(sampleThrows);
  const [rounds, setRounds] = useState<DebugRoundSummary[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<DebugArtifact[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Rounds are listed newest first; the current round is preselected when it has debug images.
  const loadRounds = useCallback(async () => {
    const list = await bullTrackNativeBridge.listDebugRounds();
    setRounds(list);
    setSelectedRoundId(selected => {
      if (selected && list.some(round => round.roundId === selected)) {
        return selected;
      }
      return list.find(round => round.roundId === currentRoundId)?.roundId ?? list[0]?.roundId ?? null;
    });
  }, [currentRoundId]);

  useEffect(() => {
    loadRounds().catch(() => undefined);
  }, [loadRounds]);

  useEffect(() => {
    setExportError(null);
    if (!selectedRoundId) {
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    bullTrackNativeBridge
      .loadDebugArtifacts(selectedRoundId)
      .then(list => {
        if (!cancelled) {
          setArtifacts(list);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedRoundId]);

  const shareSelectedRound = async () => {
    if (!selectedRoundId) {
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      await bullTrackNativeBridge.shareDebugRound(selectedRoundId);
    } catch (error) {
      setExportError(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Debug"
        title="调试图"
        description="保存最近 10 轮的调试图和日志。识别出错时选中那一轮导出调试包，反馈问题时附上。"
      />

      <Panel>
        <Text style={styles.panelTitle}>虚拟靶盘预览</Text>
        <Text style={styles.body} testID="debug-board-labels">
          {boardThrows.map(item => `${item.label} ${item.score}`).join(' / ')}
        </Text>
        <View style={styles.boardFrame}>
          <DartBoard
            size={300}
            throws={boardThrows}
            editable
            onThrowChange={(index, throwResult) =>
              setBoardThrows(current => current.map((item, i) => (i === index ? throwResult : item)))
            }
          />
        </View>
      </Panel>

      <Panel>
        <Text style={styles.panelTitle}>轮次</Text>
        {rounds.length === 0 ? (
          <Text style={styles.body}>还没有保存的调试图。打开「显示调试信息」后打一轮，这里就会出现。</Text>
        ) : (
          <View style={styles.chips}>
            {rounds.map(round => {
              const selected = round.roundId === selectedRoundId;
              return (
                <Pressable
                  key={round.roundId}
                  onPress={() => setSelectedRoundId(round.roundId)}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    pressed && styles.chipPressed,
                  ]}>
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {roundLabel(round, currentRoundId)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
      </Panel>

      {selectedRoundId && artifacts.length === 0 ? (
        <Panel>
          <Text style={styles.body}>这一轮没有调试图（比如开局就失败了），调试包里只有日志。</Text>
        </Panel>
      ) : (
        <View style={styles.list}>
          {artifacts.map(artifact => (
            <DebugImageViewer key={artifact.id} artifact={artifact} />
          ))}
        </View>
      )}

      <View style={styles.actionGroup}>
        <SecondaryButton
          label={exporting ? '正在打包…' : '导出调试包'}
          onPress={() => {
            shareSelectedRound().catch(() => undefined);
          }}
          disabled={!selectedRoundId || exporting}
        />
        <SecondaryButton
          label="重新加载"
          onPress={() => {
            loadRounds().catch(() => undefined);
          }}
        />
        <SecondaryButton label="返回" onPress={() => navigation.goBack()} />
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
  error: {
    fontSize: 14,
    color: colors.danger,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.panelStrong,
  },
  chipSelected: {
    backgroundColor: colors.accent,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  chipLabelSelected: {
    color: colors.panel,
    fontWeight: '700',
  },
  list: {
    gap: 12,
  },
  boardFrame: {
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#15120F',
  },
  actionGroup: {
    gap: 12,
  },
});
