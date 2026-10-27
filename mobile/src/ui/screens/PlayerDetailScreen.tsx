import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { PlayerEditDialog } from '../components/PlayerEditDialog';
import type { RootStackParamList } from '../../app/navigation/types';
import { getPlayerDetail } from '../../application/services/historyRepository';
import type { PlayerDetail } from '../../domain/history/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerDetail'>;

const TREND_HEIGHT = 96;

const formatRate = (wins: number, played: number) =>
  `${Math.round((wins / Math.max(1, played)) * 100)}%`;

const formatDay = (createdAt: number) => {
  const date = new Date(createdAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const StatTile = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.tile}>
    <Text style={styles.tileValue}>{value}</Text>
    <Text style={styles.tileLabel}>{label}</Text>
  </View>
);

export const PlayerDetailScreen = ({ navigation, route }: Props) => {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    getPlayerDetail(route.params.playerId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoaded(true));
  }, [route.params.playerId, reloadKey]);

  // Stable while open, so the dialog does not reset its input on re-render.
  const editTarget = useMemo(
    () => (editing && detail ? { playerId: detail.playerId, name: detail.name } : null),
    [editing, detail],
  );

  if (!loaded) {
    return <Text style={styles.empty}>正在读取…</Text>;
  }
  if (!detail) {
    return <Text style={styles.empty}>找不到这个玩家。</Text>;
  }

  const trendMax = Math.max(1, ...detail.x01Trend.map(point => point.average));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <View style={styles.summaryText}>
          <Text numberOfLines={1} style={styles.name}>
            {detail.name}
          </Text>
          <Text style={styles.meta}>
            {detail.matchesPlayed} 场 · 胜 {detail.wins} 场 · 胜率{' '}
            {formatRate(detail.wins, detail.matchesPlayed)}
          </Text>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => setEditing(true)}
          style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
          <Text style={styles.editLabel}>编辑</Text>
        </Pressable>
      </View>

      {detail.x01 ? (
        <>
          <Text style={styles.sectionTitle}>X01</Text>
          <View style={styles.tiles}>
            <StatTile label="三镖均分" value={detail.x01.average.toFixed(1)} />
            <StatTile label="前 9 镖均分" value={detail.x01.first9Average.toFixed(1)} />
            <StatTile label="180 次数" value={`${detail.x01.count180}`} />
            <StatTile label="最高收镖" value={`${detail.x01.bestCheckout ?? '—'}`} />
          </View>
        </>
      ) : null}

      {detail.x01Trend.length >= 2 ? (
        <>
          <Text style={styles.sectionTitle}>最近 {detail.x01Trend.length} 场 X01 均分</Text>
          <View style={[styles.card, styles.trend]}>
            {detail.x01Trend.map(point => (
              <View key={point.matchId} style={styles.trendColumn}>
                <Text style={styles.trendValue}>{Math.round(point.average)}</Text>
                <View
                  style={[
                    styles.trendBar,
                    { height: Math.max(2, (point.average / trendMax) * TREND_HEIGHT) },
                  ]}
                />
                <Text style={styles.trendDay}>{formatDay(point.createdAt)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {detail.cricketMpr !== null ? (
        <>
          <Text style={styles.sectionTitle}>Cricket</Text>
          <View style={styles.tiles}>
            <StatTile label="MPR（每轮平均记次）" value={detail.cricketMpr.toFixed(2)} />
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>各玩法</Text>
      <View style={styles.card}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.cellName, styles.headerText]}>玩法</Text>
          <Text style={[styles.cell, styles.headerText]}>场次</Text>
          <Text style={[styles.cell, styles.headerText]}>胜率</Text>
          <Text style={[styles.cell, styles.headerText]}>最好成绩</Text>
        </View>
        {detail.modes.map(mode => (
          <View key={mode.mode} style={styles.tableRow}>
            <Text numberOfLines={1} style={styles.cellName}>
              {mode.modeLabel ?? mode.mode}
            </Text>
            <Text style={styles.cell}>{mode.matchesPlayed}</Text>
            <Text style={styles.cell}>{formatRate(mode.wins, mode.matchesPlayed)}</Text>
            <Text style={styles.cell}>{mode.bestScore ?? '—'}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.note}>
        X01 均分按每镖实际得分算，爆镖轮也计入。最好成绩只算计分类玩法的个人赛，从这个版本起记录。
      </Text>

      <PlayerEditDialog
        player={editTarget}
        onClose={() => setEditing(false)}
        onChanged={change => {
          setEditing(false);
          if (change === 'renamed') {
            setReloadKey(key => key + 1);
          } else {
            navigation.goBack();
          }
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
    color: colors.textSecondary,
    textAlign: 'center',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryText: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  meta: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  editButton: {
    backgroundColor: colors.panelStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.7,
  },
  editLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 4,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.accent,
  },
  tileLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
  },
  trend: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 12,
  },
  trendColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  trendValue: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  trendBar: {
    width: '60%',
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  trendDay: {
    fontSize: 10,
    color: colors.textSecondary,
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
    flex: 1.8,
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
  note: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
