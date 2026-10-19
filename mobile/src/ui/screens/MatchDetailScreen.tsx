import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { getMatchDetail } from '../../application/services/historyRepository';
import type { MatchDetail } from '../../domain/history/types';
import { formatMatchTime } from './StatsTab';

type Props = NativeStackScreenProps<RootStackParamList, 'MatchDetail'>;

const formatDart = (dart: { target: string; multiplier: number }) => {
  if (dart.target === 'miss') {
    return '脱靶';
  }
  if (dart.target === 'IB') {
    return '内牛';
  }
  if (dart.target === 'OB') {
    return '外牛';
  }
  return dart.multiplier === 3 ? `T${dart.target}` : dart.multiplier === 2 ? `D${dart.target}` : dart.target;
};

export const MatchDetailScreen = ({ route }: Props) => {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getMatchDetail(route.params.matchId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoaded(true));
  }, [route.params.matchId]);

  const nameById = useMemo(
    () => new Map(detail?.players.map(player => [player.playerId, player.name]) ?? []),
    [detail],
  );

  if (!loaded) {
    return <Text style={styles.empty}>正在读取…</Text>;
  }
  if (!detail) {
    return <Text style={styles.empty}>找不到这场比赛。</Text>;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <Text style={styles.title}>{detail.modeLabel ?? detail.mode}</Text>
        <Text style={styles.meta}>{formatMatchTime(detail.createdAt)}</Text>
        <Text style={styles.players}>
          {detail.players
            .map(player => (player.isWinner ? `🏆 ${player.name}` : player.name))
            .join('   ')}
        </Text>
      </View>

      <View style={styles.card}>
        {detail.rounds.map(round => (
          <View key={`${round.roundIndex}-${round.playerId}`} style={styles.roundRow}>
            <Text style={styles.roundIndex}>{round.roundIndex}</Text>
            <Text numberOfLines={1} style={styles.roundPlayer}>
              {nameById.get(round.playerId) ?? '—'}
            </Text>
            <Text style={styles.roundDarts}>{round.throws.map(formatDart).join('  ')}</Text>
            <Text style={styles.roundTotal}>
              {round.throws.reduce((sum, dart) => sum + dart.score, 0)}
            </Text>
          </View>
        ))}
      </View>
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
});
