import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { startGameSession } from '../../application/services/liveRoundService';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerSetup'>;

export const PlayerSetupScreen = ({ navigation, route }: Props) => {
  const [playerNames, setPlayerNames] = useState(['', '']);
  const playerCount = playerNames.length;
  const title = useMemo(() => {
    switch (route.params.gameType) {
      case 'highScore':
        return '高分赛';
      case 'game301':
        return '301';
      case 'game501':
        return '501';
      case 'cricket':
        return 'Cricket';
    }
  }, [route.params.gameType]);

  const updatePlayerName = (index: number, value: string) => {
    const next = [...playerNames];
    next[index] = value;
    setPlayerNames(next);
  };

  const addPlayer = () => {
    if (playerNames.length < 4) {
      setPlayerNames([...playerNames, '']);
    }
  };

  const removePlayer = () => {
    if (playerNames.length > 1) {
      setPlayerNames(playerNames.slice(0, -1));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="Step 2"
        title={`${title} 玩家设置`}
        description="设置 1 到 4 位玩家，空名字会自动回退为默认名。"
      />

      <Panel>
        <View style={styles.rowBetween}>
          <Text style={styles.panelTitle}>玩家数量</Text>
          <Text style={styles.count}>{playerCount}</Text>
        </View>
        <View style={styles.inlineActions}>
          <SecondaryButton
            label="减少 1 人"
            onPress={removePlayer}
            disabled={playerCount <= 1}
          />
          <SecondaryButton
            label="增加 1 人"
            onPress={addPlayer}
            disabled={playerCount >= 4}
          />
        </View>
      </Panel>

      <Panel>
        <Text style={styles.panelTitle}>玩家名单</Text>
        <View style={styles.inputList}>
          {playerNames.map((playerName, index) => (
            <View key={`player-${index + 1}`} style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Player {index + 1}</Text>
              <TextInput
                value={playerName}
                onChangeText={value => updatePlayerName(index, value)}
                placeholder="输入名字，可留空"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
            </View>
          ))}
        </View>
      </Panel>

      <View style={styles.actionGroup}>
        <SecondaryButton label="返回模式选择" onPress={() => navigation.goBack()} />
        <PrimaryButton
          label="进入对局"
          onPress={() => {
            startGameSession(route.params.gameType, playerNames);
            navigation.navigate('Game');
          }}
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
    gap: 12,
  },
  inputList: {
    gap: 14,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  actionGroup: {
    gap: 12,
  },
});
