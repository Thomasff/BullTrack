import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, teamColors } from '../theme/colors';
import {
  DARTS_99_ROUNDS,
  GOTCHA_TARGET,
  HIGH_SCORE_ROUNDS,
  KILLER_LIVES,
  getAroundTheClockTarget,
  getCricketTargets,
  getRoundTarget,
  isCricketType,
} from '../../application/services/gameRules';
import type { GameType, PlayerSummary } from '../../domain/game/types';
import type { TeamInfo } from '../../domain/game/teams';

interface ScoreboardProps {
  gameType: GameType | null;
  // The scored sides: players, or teams in a team game.
  players: PlayerSummary[];
  currentPlayerId: string | null;
  winnerId: string | null;
  // Team game only: lists each team's members and marks whose turn it is.
  teams?: TeamInfo[] | null;
  people?: PlayerSummary[];
  currentThrowerId?: string | null;
}

// Cricket table columns: high numbers first, bull last; empty for other games.
const getCricketRows = (gameType: GameType | null) =>
  isCricketType(gameType)
    ? [...getCricketTargets(gameType).filter(target => target !== '25').reverse(), '25']
    : [];

const targetText = (target: number | string | null) =>
  target === null
    ? '完成'
    : target === 25
      ? '靶心'
      : target === 'double'
        ? '双倍'
        : target === 'triple'
          ? '三倍'
          : target === 'innerBull'
            ? '内牛'
            : `${target}`;

const killerLives = (lives: number) =>
  `${'♥'.repeat(Math.max(0, lives))}${'♡'.repeat(Math.max(0, KILLER_LIVES - lives))}`;

const markSymbol = (marks: number) => ['·', '/', '✕', 'Ⓧ'][Math.min(marks, 3)];

const average = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const describePlayer = (gameType: GameType | null, player: PlayerSummary) => {
  const rounds = player.roundScores.length;
  switch (gameType) {
    case 'game301':
    case 'game501':
    case 'game701':
      return {
        value: `${player.score}`,
        detail: rounds > 0 ? `均 ${average(player.roundScores).toFixed(1)}` : '剩余',
      };
    case 'highScore':
      return { value: `${player.score}`, detail: `${rounds}/${HIGH_SCORE_ROUNDS} 轮` };
    case 'darts99':
      return { value: `${player.score}`, detail: `${rounds * 3}/${DARTS_99_ROUNDS * 3} 镖` };
    case 'aroundTheClock':
      return { value: targetText(getAroundTheClockTarget(player.score)), detail: `${rounds} 轮` };
    case 'cricketNoScore': {
      const targets = getCricketTargets(gameType);
      const closed = targets.filter(target => (player.marks?.[target] ?? 0) >= 3).length;
      return { value: `${closed}/${targets.length}`, detail: '已关闭' };
    }
    case 'cutThroat':
      return { value: `${player.score}`, detail: '分 · 低者胜' };
    case 'gotcha301':
      return { value: `${player.score}`, detail: `还差 ${GOTCHA_TARGET - player.score}` };
    case 'shanghai':
    case 'halfIt':
    case 'bermuda': {
      const target = getRoundTarget(gameType, rounds + 1);
      return {
        value: `${player.score}`,
        detail: target === null ? '完成' : `目标 ${targetText(target)}`,
      };
    }
    case 'killer': {
      const state = player.killer;
      if (!state || state.lives <= 0) {
        return { value: `${state?.number ?? '—'}`, detail: '出局' };
      }
      return {
        value: `${state.number}`,
        detail: `${state.isKiller ? '杀手 ' : ''}${killerLives(state.lives)}`,
      };
    }
    default:
      return { value: `${player.score}`, detail: '分' };
  }
};

export const Scoreboard = ({
  gameType,
  players,
  currentPlayerId,
  winnerId,
  teams = null,
  people = [],
  currentThrowerId = null,
}: ScoreboardProps) => (
  <View style={styles.container}>
    <View style={styles.cards}>
      {players.map(player => {
        const { value, detail } = describePlayer(gameType, player);
        const isCurrent = winnerId === null && player.id === currentPlayerId;
        const isWinner = player.id === winnerId;
        const team = teams?.find(item => item.id === player.id) ?? null;
        const teamColor = team ? teamColors[team.index % teamColors.length] : null;
        const isOut = player.killer !== undefined && player.killer.lives <= 0;
        return (
          <View
            key={player.id}
            style={[
              styles.card,
              isCurrent && styles.cardCurrent,
              isWinner && styles.cardWinner,
              isOut && styles.cardOut,
            ]}>
            <View style={styles.nameRow}>
              {teamColor ? <View style={[styles.teamDot, { backgroundColor: teamColor }]} /> : null}
              <Text numberOfLines={1} style={[styles.name, isCurrent && styles.nameCurrent]}>
                {isWinner ? '🏆 ' : ''}
                {player.name}
              </Text>
            </View>
            <Text style={styles.value}>{value}</Text>
            <Text style={styles.detail}>{detail}</Text>
            {team ? (
              <Text numberOfLines={2} style={styles.members}>
                {team.memberIds.map((memberId, index) => (
                  <Text
                    key={memberId}
                    style={
                      isCurrent && memberId === currentThrowerId
                        ? [styles.memberCurrent, { color: teamColor ?? colors.accent }]
                        : undefined
                    }>
                    {index > 0 ? ' · ' : ''}
                    {people.find(person => person.id === memberId)?.name ?? '—'}
                  </Text>
                ))}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>

    <CricketTable gameType={gameType} players={players} />
  </View>
);

const CricketTable = ({
  gameType,
  players,
}: {
  gameType: GameType | null;
  players: PlayerSummary[];
}) => {
  const rows = getCricketRows(gameType);
  if (rows.length === 0) {
    return null;
  }
  // Tactics has 12 columns; shrink the text so they fit a phone width.
  const compact = rows.length > 7;
  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <Text style={styles.tableName} />
        {rows.map(target => (
          <Text key={target} style={[styles.tableTarget, compact && styles.tableCompact]}>
            {target === '25' ? 'B' : target}
          </Text>
        ))}
      </View>
      {players.map(player => (
        <View key={player.id} style={styles.tableRow}>
          <Text numberOfLines={1} style={styles.tableName}>
            {player.name}
          </Text>
          {rows.map(target => (
            <Text key={target} style={[styles.tableCell, compact && styles.tableCompact]}>
              {markSymbol(player.marks?.[target] ?? 0)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  cards: {
    flexDirection: 'row',
    gap: 8,
  },
  card: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: colors.panel,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 2,
  },
  cardCurrent: {
    borderColor: colors.accent,
  },
  cardWinner: {
    borderColor: colors.success,
  },
  cardOut: {
    opacity: 0.45,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
  },
  teamDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  name: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  members: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  memberCurrent: {
    fontWeight: '800',
  },
  nameCurrent: {
    color: colors.accent,
  },
  value: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  detail: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  table: {
    borderRadius: 14,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  tableName: {
    width: 64,
    paddingLeft: 10,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tableTarget: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '800',
    color: colors.accent,
  },
  tableCompact: {
    fontSize: 13,
  },
  tableCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
