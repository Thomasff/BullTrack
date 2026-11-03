import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import {
  deletePlayer,
  mergePlayerInto,
  renamePlayer,
} from '../../application/services/historyRepository';
import { isDefaultPlayerName } from '../../domain/game/players';

interface PlayerEditDialogProps {
  // null keeps the dialog closed.
  player: { playerId: number; name: string } | null;
  onClose: () => void;
  // Called after a rename, merge or delete; after the last two the player is gone.
  onChanged: (change: 'renamed' | 'merged' | 'deleted') => void;
}

type Step = 'edit' | 'confirmMerge' | 'confirmDelete';

// Rename a player (merging into an existing name on request) or delete them.
export const PlayerEditDialog = ({ player, onClose, onChanged }: PlayerEditDialogProps) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('edit');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStep('edit');
    setName(player?.name ?? '');
    setError(null);
    setBusy(false);
  }, [player]);

  const trimmed = name.trim();

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    action()
      .catch(() => {
        setStep('edit');
        setError(t('setup.playerEdit.saveFailed'));
      })
      .finally(() => setBusy(false));
  };

  const save = () => {
    if (!player) {
      return;
    }
    if (!trimmed) {
      setError(t('setup.playerEdit.nameEmpty'));
      return;
    }
    // Rejects default names in either language ("玩家 2", "Player 2").
    if (isDefaultPlayerName(trimmed)) {
      setError(t('setup.playerEdit.nameReserved'));
      return;
    }
    if (trimmed === player.name) {
      onClose();
      return;
    }
    run(async () => {
      const result = await renamePlayer(player.playerId, trimmed);
      if (result === 'nameTaken') {
        setError(null);
        setStep('confirmMerge');
      } else {
        onChanged('renamed');
      }
    });
  };

  const merge = () => {
    if (!player) {
      return;
    }
    run(async () => {
      const result = await mergePlayerInto(player.playerId, trimmed);
      if (result === 'sharedMatch') {
        setStep('edit');
        setError(t('setup.playerEdit.mergeConflict', { from: player.name, to: trimmed }));
      } else {
        onChanged('merged');
      }
    });
  };

  const remove = () => {
    if (!player) {
      return;
    }
    run(async () => {
      await deletePlayer(player.playerId);
      onChanged('deleted');
    });
  };

  const renderBody = () => {
    if (step === 'confirmMerge') {
      return (
        <>
          <Text style={styles.title}>{t('setup.playerEdit.mergeTitle')}</Text>
          <Text style={styles.message}>
            {t('setup.playerEdit.mergeMessage', { to: trimmed, from: player?.name ?? '' })}
          </Text>
          <View style={styles.actions}>
            <View style={styles.action}>
              <SecondaryButton
                label={t('common.back')}
                disabled={busy}
                onPress={() => setStep('edit')}
              />
            </View>
            <View style={styles.action}>
              <PrimaryButton label={t('setup.playerEdit.merge')} disabled={busy} onPress={merge} />
            </View>
          </View>
        </>
      );
    }
    if (step === 'confirmDelete') {
      return (
        <>
          <Text style={styles.title}>{t('setup.playerEdit.deleteTitle')}</Text>
          <Text style={styles.message}>
            {t('setup.playerEdit.deleteMessage', { name: player?.name ?? '' })}
          </Text>
          <View style={styles.actions}>
            <View style={styles.action}>
              <SecondaryButton
                label={t('common.back')}
                disabled={busy}
                onPress={() => setStep('edit')}
              />
            </View>
            <View style={styles.action}>
              <PrimaryButton label={t('common.delete')} danger disabled={busy} onPress={remove} />
            </View>
          </View>
        </>
      );
    }
    return (
      <>
        <Text style={styles.title}>{t('setup.playerEdit.editTitle')}</Text>
        <TextInput
          value={name}
          onChangeText={value => {
            setName(value);
            setError(null);
          }}
          maxLength={16}
          placeholder={t('setup.playerEdit.namePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <View style={styles.action}>
            <SecondaryButton label={t('common.cancel')} disabled={busy} onPress={onClose} />
          </View>
          <View style={styles.action}>
            <PrimaryButton label={t('common.save')} disabled={busy} onPress={save} />
          </View>
        </View>
        <Pressable
          disabled={busy}
          hitSlop={8}
          onPress={() => {
            setError(null);
            setStep('confirmDelete');
          }}
          style={styles.deleteLink}>
          <Text style={styles.deleteLabel}>{t('setup.playerEdit.deletePlayer')}</Text>
        </Pressable>
      </>
    );
  };

  return (
    <Modal
      transparent
      statusBarTranslucent
      animationType="fade"
      visible={player !== null}
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          {renderBody()}
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
    padding: 28,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 22,
    padding: 22,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  action: {
    flex: 1,
  },
  deleteLink: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  deleteLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.danger,
  },
});
