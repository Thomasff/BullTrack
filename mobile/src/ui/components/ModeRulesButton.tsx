import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameStore } from '../../application/stores/gameStore';
import { MODE_RULES } from '../../domain/game/modeRules';
import type { GameType } from '../../domain/game/types';
import { colors } from '../theme/colors';
import { PrimaryButton } from './PrimaryButton';

interface ModeRulesButtonProps {
  gameType: GameType;
  title: string;
}

// Header ⓘ button that opens the game's rules. The rules scroll; the 知道了 button stays
// pinned at the bottom of the dialog.
export const ModeRulesButton = ({ gameType, title }: ModeRulesButtonProps) => {
  const [visible, setVisible] = useState(false);
  const close = () => setVisible(false);
  return (
    <>
      <Pressable
        accessibilityLabel="玩法规则"
        hitSlop={12}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}>
        <Text style={styles.iconText}>i</Text>
      </Pressable>
      <Modal
        transparent
        statusBarTranslucent
        animationType="fade"
        visible={visible}
        onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View style={styles.card}>
            <Text style={styles.title}>{title} 规则</Text>
            <ScrollView style={styles.body} contentContainerStyle={styles.points}>
              {MODE_RULES[gameType].map(point => (
                <Text key={point.label} style={styles.point}>
                  <Text style={styles.label}>{point.label}　</Text>
                  {point.text}
                </Text>
              ))}
            </ScrollView>
            <PrimaryButton label="知道了" onPress={close} />
          </View>
        </View>
      </Modal>
    </>
  );
};

// For the Game screen, whose mode lives in the game store.
export const CurrentModeRulesButton = () => {
  const gameType = useGameStore(state => state.selectedMode);
  const title = useGameStore(state => state.selectedModeLabel);
  return gameType ? <ModeRulesButton gameType={gameType} title={title ?? ''} /> : null;
};

const styles = StyleSheet.create({
  icon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.6,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {
    opacity: 0.5,
  },
  iconText: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 12, 0.45)',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    maxHeight: '80%',
    backgroundColor: colors.panel,
    borderRadius: 22,
    padding: 22,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  // Shrinks to fit the card so long rules scroll instead of pushing the button off.
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  points: {
    gap: 12,
  },
  point: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  label: {
    fontWeight: '800',
    color: colors.accent,
  },
});
