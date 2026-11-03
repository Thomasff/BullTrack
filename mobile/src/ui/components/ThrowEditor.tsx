import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import {
  BOARD_SECTORS,
  createThrow,
  getThrowSector,
  type ThrowRing,
} from '../../domain/game/throws';
import type { ThrowResult } from '../../domain/game/types';

type Multiplier = 'single' | 'double' | 'triple';

interface ThrowEditorProps {
  visible: boolean;
  initialThrow: ThrowResult | null;
  onCancel: () => void;
  onSave: (throwResult: ThrowResult) => void;
}

const multiplierOptions: Array<{ value: Multiplier; labelKey: `game.editor.${Multiplier}` }> = [
  { value: 'single', labelKey: 'game.editor.single' },
  { value: 'double', labelKey: 'game.editor.double' },
  { value: 'triple', labelKey: 'game.editor.triple' },
];

const toMultiplier = (ring: ThrowRing | undefined): Multiplier =>
  ring === 'double' || ring === 'triple' ? ring : 'single';

export const ThrowEditor = ({ visible, initialThrow, onCancel, onSave }: ThrowEditorProps) => {
  const { t } = useTranslation();
  const [multiplier, setMultiplier] = useState<Multiplier>('single');

  useEffect(() => {
    if (visible) {
      setMultiplier(toMultiplier(initialThrow?.ring));
    }
  }, [initialThrow, visible]);

  const save = (ring: ThrowRing, sector = 0) => {
    onSave({ ...createThrow(ring, sector, initialThrow?.id), placedByHand: true });
  };
  const currentSector = initialThrow ? getThrowSector(initialThrow) : -1;

  return (
    <Modal
      transparent
      statusBarTranslucent
      animationType="fade"
      visible={visible}
      onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{t('game.editor.title')}</Text>
          <View style={styles.segment}>
            {multiplierOptions.map(option => (
              <Pressable
                key={option.value}
                onPress={() => setMultiplier(option.value)}
                style={[styles.segmentItem, multiplier === option.value && styles.segmentActive]}>
                <Text
                  style={[
                    styles.segmentLabel,
                    multiplier === option.value && styles.segmentLabelActive,
                  ]}>
                  {t(option.labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.grid}>
            {BOARD_SECTORS.map(sector => (
              <Pressable
                key={sector}
                onPress={() => save(multiplier, sector)}
                style={({ pressed }) => [
                  styles.cell,
                  currentSector === sector && styles.cellCurrent,
                  pressed && styles.cellPressed,
                ]}>
                <Text style={styles.cellLabel}>{sector}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.specialRow}>
            <Pressable style={styles.special} onPress={() => save('outerBull')}>
              <Text style={styles.cellLabel}>{t('game.editor.outerBull')}</Text>
            </Pressable>
            <Pressable style={styles.special} onPress={() => save('innerBull')}>
              <Text style={styles.cellLabel}>{t('game.editor.innerBull')}</Text>
            </Pressable>
            <Pressable style={styles.special} onPress={() => save('miss')}>
              <Text style={styles.cellLabel}>{t('common.miss')}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.cancel} onPress={onCancel}>
            <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 12, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.panelStrong,
    borderRadius: 12,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.accent,
  },
  segmentLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  segmentLabelActive: {
    color: '#FFF9F1',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  cell: {
    width: '18.5%',
    aspectRatio: 1.3,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellCurrent: {
    borderColor: colors.accent,
  },
  cellPressed: {
    backgroundColor: colors.panelStrong,
  },
  cellLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    // Android adds extra top padding to text, which pushes digits below center.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  specialRow: {
    flexDirection: 'row',
    gap: 8,
  },
  special: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancel: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelLabel: {
    fontSize: 15,
    color: colors.textSecondary,
  },
});
