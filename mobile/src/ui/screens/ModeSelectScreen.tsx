import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import {
  getModeCategory,
  getModeOption,
  getModeOptionsByCategory,
  type ModeOptionId,
} from '../../domain/game/modeCatalog';

type Props = NativeStackScreenProps<RootStackParamList, 'ModeSelect'>;

export const ModeSelectScreen = ({ navigation, route }: Props) => {
  const category = getModeCategory(route.params.categoryId);
  const options = useMemo(
    () => getModeOptionsByCategory(route.params.categoryId),
    [route.params.categoryId],
  );
  const [selectedMode, setSelectedMode] = useState<ModeOptionId | null>(null);
  const subtitle = useMemo(
    () =>
      selectedMode
        ? (getModeOption(selectedMode)?.description ??
          '先选择这一局的计分规则。')
        : '先选择这一局的计分规则。',
    [selectedMode],
  );

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow={category?.title ?? '模式'}
        title={category?.title ?? '选择游戏模式'}
        description={subtitle}
      />

      <View style={styles.optionList}>
        {options.map(option => {
          const selected = option.id === selectedMode;
          return (
            <Pressable
              key={option.id}
              onPress={() => setSelectedMode(option.id)}
              style={[styles.optionCard, selected && styles.optionCardSelected]}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actionGroup}>
        <SecondaryButton label="返回首页" onPress={() => navigation.goBack()} />
        <PrimaryButton
          label="开始"
          onPress={() =>
            selectedMode &&
            navigation.navigate('PlayerSetup', {
              modeOptionId: selectedMode,
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
    borderRadius: 8,
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
  actionGroup: {
    gap: 12,
  },
});
