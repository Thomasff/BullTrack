import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { getModeOptionsByCategory } from '../../domain/game/modeCatalog';

type Props = NativeStackScreenProps<RootStackParamList, 'ModeSelect'>;

export const ModeSelectScreen = ({ navigation, route }: Props) => {
  const options = useMemo(
    () => getModeOptionsByCategory(route.params.categoryId),
    [route.params.categoryId],
  );

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.optionList}>
        {options.map(option => (
          <Pressable
            key={option.id}
            onPress={() => navigation.navigate('PlayerSetup', { modeOptionId: option.id })}
            style={({ pressed }) => [styles.optionCard, pressed && styles.optionCardPressed]}>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
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
    padding: 20,
  },
  optionList: {
    gap: 12,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
  optionCardPressed: {
    backgroundColor: colors.panelStrong,
  },
  optionText: {
    flex: 1,
    gap: 6,
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
  chevron: {
    fontSize: 28,
    color: colors.textSecondary,
  },
});
