import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { PlayerEditDialog } from '../components/PlayerEditDialog';
import {
  listPlayerStats,
  listRecentMatches,
} from '../../application/services/historyRepository';
import type { PlayerStats, RecentMatchSummary } from '../../domain/history/types';

interface StatsTabProps {
  onOpenMatch: (matchId: number) => void;
}

export const formatMatchTime = (createdAt: number) => {
  const date = new Date(createdAt);
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

export const StatsTab = ({ onOpenMatch }: StatsTabProps) => {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [matches, setMatches] = useState<RecentMatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlayerStats | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    Promise.all([listPlayerStats(), listRecentMatches(50)])
      .then(([playerStats, recentMatches]) => {
        if (isMounted) {
          setPlayers(playerStats);
          setMatches(recentMatches);
        }
      })
      .catch(loadError => {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : '读取历史失败');
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  if (loading) {
    return <Text style={styles.empty}>正在读取…</Text>;
  }
  if (error) {
    return <Text style={[styles.empty, styles.error]}>读取历史失败：{error}</Text>;
  }
  if (matches.length === 0) {
    return <Text style={styles.empty}>还没有完成的比赛。打完一局后会出现在这里。</Text>;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>玩家</Text>
      <Text style={styles.hint}>点玩家可改名、合并或删除；没填名字的「玩家 N」不计入统计。</Text>
      <View style={styles.card}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.cellName, styles.headerText]}>玩家</Text>
          <Text style={[styles.cell, styles.headerText]}>场次</Text>
          <Text style={[styles.cell, styles.headerText]}>胜率</Text>
          <Text style={[styles.cell, styles.headerText]}>X01 均分</Text>
          <Text style={[styles.cell, styles.headerText]}>最高轮</Text>
        </View>
        {players.length === 0 ? <Text style={styles.noPlayers}>暂无</Text> : null}
        {players.map(player => (
          <Pressable
            key={player.playerId}
            onPress={() => setEditing(player)}
            style={({ pressed }) => [styles.tableRow, pressed && styles.pressed]}>
            <Text numberOfLines={1} style={styles.cellName}>
              {player.name}
            </Text>
            <Text style={styles.cell}>{player.matchesPlayed}</Text>
            <Text style={styles.cell}>
              {Math.round((player.wins / Math.max(1, player.matchesPlayed)) * 100)}%
            </Text>
            <Text style={styles.cell}>
              {player.x01Average === null ? '—' : player.x01Average.toFixed(1)}
            </Text>
            <Text style={styles.cell}>{player.bestRound ?? '—'}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>最近比赛</Text>
      <View style={styles.matchList}>
        {matches.map(match => (
          <Pressable
            key={match.id}
            onPress={() => onOpenMatch(match.id)}
            style={({ pressed }) => [styles.matchCard, pressed && styles.pressed]}>
            <View style={styles.matchText}>
              <Text style={styles.matchTitle}>{match.modeLabel ?? match.mode}</Text>
              <Text style={styles.matchMeta}>
                {formatMatchTime(match.createdAt)} · {match.playerCount} 人
              </Text>
            </View>
            <Text style={styles.winner}>🏆 {match.winnerName ?? '—'}</Text>
          </Pressable>
        ))}
      </View>

      <PlayerEditDialog
        player={editing}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setEditing(null);
          setReloadKey(key => key + 1);
        }}
      />
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
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 4,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  noPlayers: {
    padding: 12,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tableHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  cellName: {
    flex: 1.6,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cell: {
    flex: 1,
    fontSize: 14,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  matchList: {
    gap: 10,
  },
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  pressed: {
    backgroundColor: colors.panelStrong,
  },
  matchText: {
    flex: 1,
    gap: 4,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  matchMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  winner: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
  },
});
