import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { startGameSession } from '../../application/services/liveRoundService';
import { listKnownPlayerNames } from '../../application/services/historyRepository';
import { getModeOption } from '../../domain/game/modeCatalog';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  findDuplicatePlayerName,
  getDefaultPlayerName,
  resolvePlayerNames,
} from '../../domain/game/players';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerSetup'>;

export const PlayerSetupScreen = ({ navigation, route }: Props) => {
  const [names, setNames] = useState<string[]>(['']);
  const [activeIndex, setActiveIndex] = useState(0);
  const [knownNames, setKnownNames] = useState<string[]>([]);
  const selectedOption = useMemo(
    () => getModeOption(route.params.modeOptionId),
    [route.params.modeOptionId],
  );

  useEffect(() => {
    listKnownPlayerNames()
      .then(setKnownNames)
      .catch(() => setKnownNames([]));
  }, []);

  const resolvedNames = resolvePlayerNames(names);
  const duplicateName = findDuplicatePlayerName(names);
  const suggestions = knownNames.filter(name => !resolvedNames.includes(name));

  const updateName = (index: number, value: string) => {
    setNames(current => current.map((name, i) => (i === index ? value : name)));
  };

  const addPlayer = () => {
    if (names.length < MAX_PLAYERS) {
      setNames(current => [...current, '']);
      setActiveIndex(names.length);
    }
  };

  const removePlayer = (index: number) => {
    if (names.length > MIN_PLAYERS) {
      setNames(current => current.filter((_, i) => i !== index));
      setActiveIndex(0);
    }
  };

  // Fills the focused seat, or the first empty one, or a new seat.
  const pickKnownName = (name: string) => {
    const targetIndex =
      names[activeIndex]?.trim() === ''
        ? activeIndex
        : names.findIndex(item => item.trim() === '');
    if (targetIndex >= 0) {
      updateName(targetIndex, name);
      return;
    }
    if (names.length < MAX_PLAYERS) {
      setNames(current => [...current, name]);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}>
      <Panel>
        <View style={styles.rowBetween}>
          <Text style={styles.panelTitle}>玩家</Text>
          <Text style={styles.hint}>
            {names.length} / {MAX_PLAYERS}
          </Text>
        </View>
        {names.map((name, index) => (
          <View key={index} style={styles.playerRow}>
            <Text style={styles.seat}>{index + 1}</Text>
            <TextInput
              value={name}
              onChangeText={value => updateName(index, value)}
              onFocus={() => setActiveIndex(index)}
              placeholder={getDefaultPlayerName(index)}
              placeholderTextColor={colors.textSecondary}
              maxLength={16}
              style={[styles.input, activeIndex === index && styles.inputActive]}
            />
            {names.length > MIN_PLAYERS ? (
              <Pressable
                hitSlop={8}
                onPress={() => removePlayer(index)}
                style={styles.removeButton}>
                <Text style={styles.removeLabel}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {names.length < MAX_PLAYERS ? (
          <Pressable onPress={addPlayer} style={styles.addButton}>
            <Text style={styles.addLabel}>+ 添加玩家</Text>
          </Pressable>
        ) : null}
        {duplicateName ? (
          <Text style={styles.error}>名字重复：{duplicateName}</Text>
        ) : null}
      </Panel>

      {suggestions.length > 0 ? (
        <Panel>
          <Text style={styles.panelTitle}>历史玩家</Text>
          <View style={styles.chips}>
            {suggestions.map(name => (
              <Pressable
                key={name}
                onPress={() => pickKnownName(name)}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}>
                <Text style={styles.chipLabel}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </Panel>
      ) : null}

      <PrimaryButton
        label="开始"
        onPress={() => {
          if (!selectedOption) {
            return;
          }
          startGameSession(
            selectedOption.runtimeGameType,
            resolvedNames,
            selectedOption.title,
          );
          navigation.navigate('Game');
        }}
        disabled={!selectedOption || duplicateName !== null}
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
    padding: 20,
    gap: 16,
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
  hint: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seat: {
    width: 20,
    fontSize: 16,
    fontWeight: '800',
    color: colors.accent,
    textAlign: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputActive: {
    borderColor: colors.accent,
  },
  removeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLabel: {
    fontSize: 22,
    color: colors.textSecondary,
  },
  addButton: {
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  addLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent,
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
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    fontSize: 15,
    color: colors.textPrimary,
  },
});
