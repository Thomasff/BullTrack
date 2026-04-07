import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { Panel } from '../components/Panel';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import type { GameType } from '../../domain/game/types';
import { useGameStore } from '../../application/stores/gameStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ModeSelect'>;

const options: Array<{
  value: GameType;
  title: string;
  description: string;
}> = [
  {
    value: 'highScore',
    title: '高分赛',
    description: '10 轮累计得分，最高分获胜。',
  },
  {
    value: 'game301',
    title: '301',
    description: '从 301 开始，需双倍区收镖。',
  },
  {
    value: 'game501',
    title: '501',
    description: '从 501 开始，需双倍区收镖。',
  },
  {
    value: 'cricket',
    title: 'Cricket',
    description: '关闭 15-20 与 Bull，并争取得分优势。',
  },
];

export const ModeSelectScreen = ({ navigation }: Props) => {
  const initialMode = useGameStore(state => state.selectedMode);
  const [selectedMode, setSelectedMode] = useState<GameType | null>(initialMode);
  const subtitle = useMemo(
    () =>
      selectedMode
        ? (options.find(option => option.value === selectedMode)?.description ??
          '先选择这一局的计分规则。')
        : '先选择这一局的计分规则。',
    [selectedMode],
  );

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Step 1"
        title="选择游戏模式"
        description={subtitle}
      />

      <View style={styles.optionList}>
        {options.map(option => {
          const selected = option.value === selectedMode;
          return (
            <Pressable
              key={option.value}
              onPress={() => setSelectedMode(option.value)}
              style={[styles.optionCard, selected && styles.optionCardSelected]}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </Pressable>
          );
        })}
      </View>

      <Panel>
        <Text style={styles.panelTitle}>迁移策略</Text>
        <Text style={styles.body}>
          第三阶段开始由 RN 管理整局流程和计分状态，原生层只负责相机预览、采图与识别结果。
        </Text>
      </Panel>

      <View style={styles.actionGroup}>
        <SecondaryButton label="返回首页" onPress={() => navigation.goBack()} />
        <PrimaryButton
          label="下一步：设置玩家"
          onPress={() =>
            selectedMode &&
            navigation.navigate('PlayerSetup', {
              gameType: selectedMode,
            })
          }
          disabled={selectedMode === null}
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
  optionList: {
    gap: 12,
  },
  optionCard: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
  },
  optionCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.panelStrong,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  optionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
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
  actionGroup: {
    gap: 12,
  },
});
