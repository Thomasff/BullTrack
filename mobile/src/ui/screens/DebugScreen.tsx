import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useVisionDebugStore } from '../../application/stores/visionDebugStore';
import { useGameStore } from '../../application/stores/gameStore';
import { reloadDebugArtifacts } from '../../application/services/liveRoundService';
import { DebugImageViewer } from '../components/DebugImageViewer';
import { Panel } from '../components/Panel';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Debug'>;

export const DebugScreen = ({ navigation }: Props) => {
  const artifacts = useVisionDebugStore(state => state.artifacts);
  const roundId = useGameStore(state => state.roundId);

  useEffect(() => {
    reloadDebugArtifacts().catch(() => undefined);
  }, [roundId]);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Debug"
        title="Native debug artifacts"
        description="调试图继续由原生层落到应用私有目录，并通过 file:// 路径交给 RN 预览。"
      />

      <Panel>
        <Text style={styles.panelTitle}>Current round</Text>
        <Text style={styles.body}>{roundId ?? '当前没有已保存的 roundId'}</Text>
      </Panel>

      {artifacts.length === 0 ? (
        <Panel>
          <Text style={styles.panelTitle}>No artifacts yet</Text>
          <Text style={styles.body}>
            在对局页完成一次识别或重检后，这里会显示当前回合的本地调试图。
          </Text>
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
          label="重新加载调试图"
          onPress={() => {
            reloadDebugArtifacts().catch(() => undefined);
          }}
        />
        <SecondaryButton label="返回对局" onPress={() => navigation.goBack()} />
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
  list: {
    gap: 12,
  },
  actionGroup: {
    gap: 12,
  },
});
