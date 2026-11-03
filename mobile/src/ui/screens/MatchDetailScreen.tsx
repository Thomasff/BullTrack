import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { RootStackParamList } from '../../app/navigation/types';
import { deleteMatch, getMatchDetail } from '../../application/services/historyRepository';
import type { MatchDetail } from '../../domain/history/types';
import { formatMatchTime } from './MatchListScreen';
import { getTeamName } from '../../domain/game/teams';
import { deleteMatchPhotos, replayMatchDetail, roundKey } from '../../application/services/shareService';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { displayPlayerName } from '../../domain/game/players';
import { modeDisplayName, t as translate } from '../../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'MatchDetail'>;

export const formatDart = (dart: { target: string; multiplier: number }) => {
  if (dart.target === 'miss') {
    return translate('common.miss');
  }
  if (dart.target === 'IB') {
    return translate('common.innerBull');
  }
  if (dart.target === 'OB') {
    return translate('common.outerBull');
  }
  return dart.multiplier === 3 ? `T${dart.target}` : dart.multiplier === 2 ? `D${dart.target}` : dart.target;
};

export const MatchDetailScreen = ({ navigation, route }: Props) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // Keys (roundKey) of the rounds that were highlights.
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(new Set());
  const selfMocking = useSettingsStore(state => state.highlightSelfMocking);

  const removeMatch = () => {
    setConfirmingDelete(false);
    deleteMatch(route.params.matchId)
      .then(() => {
        if (detail) {
          deleteMatchPhotos(detail.createdAt).catch(() => undefined);
        }
        navigation.goBack();
      })
      .catch(() => setDeleteFailed(true));
  };

  useEffect(() => {
    getMatchDetail(route.params.matchId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoaded(true));
  }, [route.params.matchId]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    let active = true;
    replayMatchDetail(detail, selfMocking)
      .then(rounds => {
        if (active) {
          setHighlightKeys(new Set(rounds.filter(item => item.share.highlight !== null).map(item => item.key)));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [detail, selfMocking]);

  const nameById = useMemo(
    () => new Map(detail?.players.map(player => [player.playerId, player.name]) ?? []),
    [detail],
  );

  // Team game: one line per team, e.g. "🏆 A 队：张三、李四".
  const teamLines = useMemo(() => {
    const players = detail?.players ?? [];
    if (!players.some(player => player.teamIndex !== null)) {
      return null;
    }
    const indexes = [...new Set(players.map(player => player.teamIndex ?? 0))].sort(
      (left, right) => left - right,
    );
    return indexes.map(index => {
      const members = players.filter(player => (player.teamIndex ?? 0) === index);
      const trophy = members.some(player => player.isWinner) ? '🏆 ' : '';
      const names = members.map(player => displayPlayerName(player.name)).join(t('history.nameSeparator'));
      return `${trophy}${t('history.teamLine', { team: getTeamName(index), members: names })}`;
    });
  }, [detail, t]);

  if (!loaded) {
    return <Text style={styles.empty}>{t('history.loading')}</Text>;
  }
  if (!detail) {
    return <Text style={styles.empty}>{t('history.matchNotFound')}</Text>;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <Text style={styles.title}>{modeDisplayName(detail.mode, detail.modeLabel)}</Text>
        <Text style={styles.meta}>{formatMatchTime(detail.createdAt)}</Text>
        {teamLines ? (
          teamLines.map(line => (
            <Text key={line} style={styles.players}>
              {line}
            </Text>
          ))
        ) : (
          <Text style={styles.players}>
            {detail.players
              .map(player => `${player.isWinner ? '🏆 ' : ''}${displayPlayerName(player.name)}`)
              .join('   ')}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        {detail.rounds.map(round => {
          const key = roundKey(round.roundIndex, nameById.get(round.playerId) ?? '');
          return (
            <View key={`${round.roundIndex}-${round.playerId}`} style={styles.roundRow}>
              <Text style={styles.roundIndex}>{round.roundIndex}</Text>
              <Text numberOfLines={1} style={styles.roundPlayer}>
                {displayPlayerName(nameById.get(round.playerId) ?? '—')}
              </Text>
              <Text style={styles.roundDarts}>{round.throws.map(formatDart).join('  ')}</Text>
              <Text style={styles.roundTotal}>
                {round.throws.reduce((sum, dart) => sum + dart.score, 0)}
              </Text>
              {highlightKeys.has(key) ? (
                <Pressable
                  accessibilityLabel={t('history.shareRound')}
                  hitSlop={10}
                  onPress={() =>
                    navigation.navigate('SharePreview', { matchId: route.params.matchId, highlight: key })
                  }
                  style={styles.star}>
                  <Text style={styles.starLabel}>★</Text>
                </Pressable>
              ) : (
                <View style={styles.star} />
              )}
            </View>
          );
        })}
      </View>

      <Pressable
        hitSlop={8}
        onPress={() => {
          setDeleteFailed(false);
          setConfirmingDelete(true);
        }}
        style={styles.deleteLink}>
        <Text style={styles.deleteLabel}>{t('history.deleteMatch')}</Text>
      </Pressable>
      {deleteFailed ? <Text style={styles.deleteError}>{t('history.deleteFailed')}</Text> : null}

      <ConfirmDialog
        visible={confirmingDelete}
        title={t('history.deleteMatch')}
        message={t('history.deleteConfirmMessage')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={removeMatch}
        onCancel={() => setConfirmingDelete(false)}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 14,
  },
  empty: {
    padding: 24,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  summary: {
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  players: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
  },
  roundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  roundIndex: {
    width: 24,
    fontSize: 13,
    color: colors.textSecondary,
  },
  roundPlayer: {
    width: 72,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  roundDarts: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
  roundTotal: {
    width: 40,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '800',
    color: colors.accent,
  },
  star: {
    width: 18,
    alignItems: 'center',
  },
  starLabel: {
    fontSize: 16,
    color: colors.accent,
  },
  deleteLink: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  deleteLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.danger,
  },
  deleteError: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
  },
});
