import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { SecondaryButton } from './SecondaryButton';
import type { LanguageChoice } from '../../i18n';

interface LanguageDialogProps {
  visible: boolean;
  selected: LanguageChoice;
  onPick: (choice: LanguageChoice) => void;
  onCancel: () => void;
}

// Language names stay in their own language, so a player who cannot read the current one finds theirs.
export const languageLabel = (choice: LanguageChoice, systemLabel: string) =>
  choice === 'zh' ? '中文' : choice === 'en' ? 'English' : systemLabel;

const CHOICES: LanguageChoice[] = ['system', 'zh', 'en'];

export const LanguageDialog = ({ visible, selected, onPick, onCancel }: LanguageDialogProps) => {
  const { t } = useTranslation();
  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{t('settings.language')}</Text>
          <View style={styles.options}>
            {CHOICES.map(choice => (
              <Pressable
                key={choice}
                onPress={() => onPick(choice)}
                style={({ pressed }) => [
                  styles.option,
                  choice === selected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}>
                <Text style={styles.optionTitle}>{languageLabel(choice, t('settings.languageSystem'))}</Text>
              </Pressable>
            ))}
          </View>
          <SecondaryButton label={t('common.cancel')} onPress={onCancel} />
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
  options: {
    gap: 8,
    marginVertical: 6,
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
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
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
