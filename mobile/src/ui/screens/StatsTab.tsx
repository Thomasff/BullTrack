import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import {
  getSetting,
  listPlayerStats,
  listRecentMatches,
  setSetting,
} from '../../application/services/historyRepository';
import type {
  PlayerStats,
  RecentMatchSummary,
} from '../../domain/history/types';
import { formatRate } from '../components/PlayerStatBlocks';
import { MatchCard } from './MatchListScreen';
import { PlayerStatsView } from './PlayerDetailScreen';

// The player the tab showed last, so it opens on them again.
const SELECTED_PLAYER_KEY = 'statsPlayerId';

interface StatsTabProps {
  onOpenMatch: (matchId: number) => void;
}

// Saved player if still listed, else whoever played most recently.
const pickPlayer = (players: PlayerStats[], savedId: number | null) =>
  players.find(player => player.playerId === savedId)?.playerId ??
  [...players].sort((left, right) => right.lastPlayedAt - left.lastPlayedAt)[0]
    ?.playerId ??
  null;

export const StatsTab = ({ onOpenMatch }: StatsTabProps) => {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Only read when no player has a name, to list the matches instead.
  const [matches, setMatches] = useState<RecentMatchSummary[]>([]);
  const [picking, setPicking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    Promise.all([listPlayerStats(), getSetting(SELECTED_PLAYER_KEY)])
      .then(async ([playerStats, savedId]) => {
        const recentMatches =
          playerStats.length === 0 ? await listRecentMatches(null) : [];
        if (isMounted) {
          setPlayers(playerStats);
          setSelectedId(
            pickPlayer(playerStats, savedId === null ? null : Number(savedId)),
          );
          setMatches(recentMatches);
        }
      })
      .catch(loadError => {
        if (isMounted) {
          setError(
            loadError instanceof Error ? loadError.message : '读取历史失败',
          );
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

  const selectPlayer = (playerId: number) => {
    setSelectedId(playerId);
    setPicking(false);
    setSetting(SELECTED_PLAYER_KEY, `${playerId}`).catch(() => undefined);
  };

  if (loading) {
    return <Text style={styles.empty}>正在读取…</Text>;
  }
  if (error) {
    return (
      <Text style={[styles.empty, styles.error]}>读取历史失败：{error}</Text>
    );
  }
  if (selectedId === null) {
    if (matches.length === 0) {
      return (
        <Text style={styles.empty}>
          还没有完成的比赛。打完一局后会出现在这里。
        </Text>
      );
    }
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          给玩家起名字后，这里会显示个人统计；没填名字的「玩家 N」不计入统计。
        </Text>
        <Text style={styles.sectionTitle}>全部比赛</Text>
        {matches.map(match => (
          <MatchCard
            key={match.id}
            match={match}
            onPress={() => onOpenMatch(match.id)}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <>
      <PlayerStatsView
        key={selectedId}
        playerId={selectedId}
        onPickPlayer={() => setPicking(true)}
        onRenamed={() => setReloadKey(key => key + 1)}
        onPlayerGone={() => setReloadKey(key => key + 1)}
      />

      <Modal
        transparent
        statusBarTranslucent
        animationType="fade"
        visible={picking}
        onRequestClose={() => setPicking(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)}>
          <Pressable style={styles.picker} onPress={() => undefined}>
            <Text style={styles.pickerTitle}>选择玩家</Text>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.cellName, styles.headerText]}>玩家</Text>
              <Text style={[styles.cell, styles.headerText]}>场次</Text>
              <Text style={[styles.cell, styles.headerText]}>胜率</Text>
              <Text style={[styles.cell, styles.headerText]}>X01 均分</Text>
            </View>
            <ScrollView>
              {players.map(player => (
                <Pressable
                  key={player.playerId}
                  onPress={() => selectPlayer(player.playerId)}
                  style={({ pressed }) => [
                    styles.tableRow,
                    player.playerId === selectedId && styles.selectedRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.cellName}>
                    {player.name}
                  </Text>
                  <Text style={styles.cell}>{player.matchesPlayed}</Text>
                  <Text style={styles.cell}>
                    {formatRate(player.wins, player.matchesPlayed)}
                  </Text>
                  <Text style={styles.cell}>
                    {player.x01Average === null
                      ? '—'
                      : player.x01Average.toFixed(1)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.hint}>没填名字的「玩家 N」不计入统计。</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 12, 0.45)',
    justifyContent: 'center',
    padding: 28,
  },
  picker: {
    maxHeight: '75%',
    backgroundColor: colors.panel,
    borderRadius: 22,
    padding: 18,
    gap: 6,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tableHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: 0,
  },
  selectedRow: {
    backgroundColor: colors.panelStrong,
  },
  pressed: {
    opacity: 0.7,
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
});
