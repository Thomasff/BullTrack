import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { StatTile, StatTiles, X01StatBlock, formatRate } from '../components/PlayerStatBlocks';
import type { RootStackParamList } from '../../app/navigation/types';
import { getPlayerDetail } from '../../application/services/historyRepository';
import type { PlayerModeMatch, PlayerModeStats } from '../../domain/history/types';
import { formatMatchTime } from './StatsTab';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerMode'>;

const formatMatchResult = (match: PlayerModeMatch) => {
  if (match.score !== null) {
    return `${match.score} 分`;
  }
  return match.average !== null ? `均分 ${match.average.toFixed(1)}` : '';
};

// One player's stats and matches in one mode, opened from the player's mode table.
export const PlayerModeScreen = ({ navigation, route }: Props) => {
  const [stats, setStats] = useState<PlayerModeStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getPlayerDetail(route.params.playerId)
      .then(detail => setStats(detail?.modes.find(mode => mode.mode === route.params.mode) ?? null))
      .catch(() => setStats(null))
      .finally(() => setLoaded(true));
  }, [route.params.playerId, route.params.mode]);

  if (!loaded) {
    return <Text style={styles.empty}>正在读取…</Text>;
  }
  if (!stats) {
    return <Text style={styles.empty}>没有这个玩法的记录。</Text>;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.meta}>
        {route.params.playerName} · {stats.matchesPlayed} 场 · 胜 {stats.wins} 场
      </Text>
      <StatTiles>
        <StatTile label="场次" value={`${stats.matchesPlayed}`} />
        <StatTile label="胜率" value={formatRate(stats.wins, stats.matchesPlayed)} />
        {stats.bestScore !== null ? (
          <StatTile label="最好成绩（个人赛）" value={`${stats.bestScore}`} />
        ) : null}
        {stats.averageScore !== null ? (
          <StatTile label="平均成绩（个人赛）" value={stats.averageScore.toFixed(1)} />
        ) : null}
        {stats.mpr !== null ? (
          <StatTile label="MPR（每轮平均记次）" value={stats.mpr.toFixed(2)} />
        ) : null}
        {stats.hitRate !== null ? (
          <StatTile label="命中 20 区的比例" value={`${Math.round(stats.hitRate * 100)}%`} />
        ) : null}
        {stats.dartsToFinish ? (
          <>
            <StatTile label="最少用镖（个人赛胜局）" value={`${stats.dartsToFinish.best}`} />
            <StatTile
              label="平均用镖（个人赛胜局）"
              value={stats.dartsToFinish.average.toFixed(1)}
            />
          </>
        ) : null}
      </StatTiles>

      {stats.x01 ? <X01StatBlock stats={stats.x01} /> : null}

      <Text style={styles.sectionTitle}>对局记录</Text>
      <View style={styles.card}>
        {stats.matches.map(match => (
          <Pressable
            key={match.matchId}
            onPress={() => navigation.navigate('MatchDetail', { matchId: match.matchId })}
            style={({ pressed }) => [styles.matchRow, pressed && styles.pressed]}>
            <Text style={styles.matchTime}>{formatMatchTime(match.createdAt)}</Text>
            <Text style={styles.matchResult}>{formatMatchResult(match)}</Text>
            <Text style={[styles.matchOutcome, match.isWinner && styles.won]}>
              {match.isWinner ? '胜' : '负'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 12,
  },
  empty: {
    padding: 24,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  meta: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pressed: {
    opacity: 0.7,
  },
  matchTime: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
  matchResult: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  matchOutcome: {
    width: 20,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.textSecondary,
  },
  won: {
    color: colors.success,
  },
  chevron: {
    fontSize: 18,
    color: colors.textSecondary,
  },
});
