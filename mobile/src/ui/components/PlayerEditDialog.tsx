import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
        setError('保存失败，请重试');
      })
      .finally(() => setBusy(false));
  };

  const save = () => {
    if (!player) {
      return;
    }
    if (!trimmed) {
      setError('名字不能为空');
      return;
    }
    if (isDefaultPlayerName(trimmed)) {
      setError('「玩家 N」是没填名字时的默认名，请换一个');
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
        setError(`「${player.name}」和「${trimmed}」在同一场比赛里出现过，不能合并`);
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
          <Text style={styles.title}>合并玩家</Text>
          <Text style={styles.message}>
            「{trimmed}」已经存在。合并后「{player?.name}」的比赛和统计都算到「{trimmed}」名下，无法撤销。
          </Text>
          <View style={styles.actions}>
            <View style={styles.action}>
              <SecondaryButton label="返回" disabled={busy} onPress={() => setStep('edit')} />
            </View>
            <View style={styles.action}>
              <PrimaryButton label="合并" disabled={busy} onPress={merge} />
            </View>
          </View>
        </>
      );
    }
    if (step === 'confirmDelete') {
      return (
        <>
          <Text style={styles.title}>删除玩家</Text>
          <Text style={styles.message}>
            「{player?.name}」会从统计和历史玩家中去掉，打过的比赛保留。以后再用这个名字打完一局会重新出现。
          </Text>
          <View style={styles.actions}>
            <View style={styles.action}>
              <SecondaryButton label="返回" disabled={busy} onPress={() => setStep('edit')} />
            </View>
            <View style={styles.action}>
              <PrimaryButton label="删除" danger disabled={busy} onPress={remove} />
            </View>
          </View>
        </>
      );
    }
    return (
      <>
        <Text style={styles.title}>编辑玩家</Text>
        <TextInput
          value={name}
          onChangeText={value => {
            setName(value);
            setError(null);
          }}
          maxLength={16}
          placeholder="名字"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <View style={styles.action}>
            <SecondaryButton label="取消" disabled={busy} onPress={onClose} />
          </View>
          <View style={styles.action}>
            <PrimaryButton label="保存" disabled={busy} onPress={save} />
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
          <Text style={styles.deleteLabel}>删除这个玩家</Text>
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
