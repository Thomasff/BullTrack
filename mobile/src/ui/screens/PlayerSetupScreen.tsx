import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { startGameSession } from '../../application/services/liveRoundService';
import { getModeOption } from '../../domain/game/modeCatalog';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerSetup'>;

export const PlayerSetupScreen = ({ navigation, route }: Props) => {
  const [playerCount, setPlayerCount] = useState(1);
  const selectedOption = useMemo(
    () => getModeOption(route.params.modeOptionId),
    [route.params.modeOptionId],
  );

  const addPlayer = () => {
    if (playerCount < 4) {
      setPlayerCount(current => current + 1);
    }
  };

  const removePlayer = () => {
    if (playerCount > 1) {
      setPlayerCount(current => current - 1);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="信息设置"
        title={selectedOption?.title ?? '信息设置'}
        description="先设置参赛人数，当前支持 1 到 4 人，点击开始后进入现有相机预览与倍率调整流程。"
      />

      <Panel>
        <View style={styles.rowBetween}>
          <Text style={styles.panelTitle}>人数</Text>
          <Text style={styles.count}>{playerCount}</Text>
        </View>
        <View style={styles.inlineActions}>
          <SecondaryButton
            label="减少"
            onPress={removePlayer}
            disabled={playerCount <= 1}
          />
          <SecondaryButton
            label="增加"
            onPress={addPlayer}
            disabled={playerCount >= 4}
          />
        </View>
      </Panel>

      <Panel>
        <Text style={styles.panelTitle}>当前模式</Text>
        <Text style={styles.bodyStrong}>{selectedOption?.title ?? '未选择'}</Text>
        <Text style={styles.body}>
          该入口当前先接入现有对局逻辑，后续再补真实玩法规则与专属结算表现。
        </Text>
      </Panel>

      <View style={styles.actionGroup}>
        <SecondaryButton label="返回选项" onPress={() => navigation.goBack()} />
        <PrimaryButton
          label="开始"
          onPress={() => {
            if (!selectedOption) {
              return;
            }
            startGameSession(
              selectedOption.runtimeGameType,
              Array.from({ length: playerCount }, (_, index) => `Player ${index + 1}`),
              selectedOption.title,
            );
            navigation.navigate('Game');
          }}
          disabled={!selectedOption}
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
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  count: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.accent,
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  bodyStrong: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  actionGroup: {
    gap: 12,
  },
});
