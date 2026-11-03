import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { SecondaryButton } from './SecondaryButton';
import { BoardFace } from './DartBoard';
import type { BoardKind } from '../../application/stores/settingsStore';

interface BoardKindDialogProps {
  visible: boolean;
  selected: BoardKind;
  // The first launch has to pick one, so it has no cancel.
  cancelable: boolean;
  onPick: (kind: BoardKind) => void;
  onCancel: () => void;
}

const BOARD_SIZE = 110;

// Translation keys of each board's title and description.
const options = [
  { kind: 'soft', title: 'common.boardSoft', description: 'setup.board.softDescription' },
  { kind: 'steel', title: 'common.boardSteel', description: 'setup.board.steelDescription' },
] as const;

// Picks the player's board type by its colours; tapping a board picks it.
export const BoardKindDialog = ({ visible, selected, cancelable, onPick, onCancel }: BoardKindDialogProps) => {
  const { t } = useTranslation();
  const close = cancelable ? onCancel : () => undefined;
  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible={visible} onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{t('setup.board.title')}</Text>
          <Text style={styles.message}>{t('setup.board.message')}</Text>
          <View style={styles.options}>
            {options.map(option => (
              <Pressable
                key={option.kind}
                onPress={() => onPick(option.kind)}
                style={({ pressed }) => [
                  styles.option,
                  option.kind === selected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}>
                <BoardFace size={BOARD_SIZE} kind={option.kind} />
                <Text style={styles.optionTitle}>{t(option.title)}</Text>
                <Text style={styles.optionDescription}>{t(option.description)}</Text>
              </Pressable>
            ))}
          </View>
          {cancelable ? <SecondaryButton label={t('common.cancel')} onPress={onCancel} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 12, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 22,
    padding: 20,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  message: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  options: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 6,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.panelStrong,
  },
  optionPressed: {
    opacity: 0.85,
  },
  optionTitle: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  optionDescription: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
