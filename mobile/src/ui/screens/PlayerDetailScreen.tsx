import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { PlayerEditDialog } from '../components/PlayerEditDialog';
import { HitMapBoard } from '../components/HitMapBoard';
import { StatTile, StatTiles, X01StatBlock, formatRate } from '../components/PlayerStatBlocks';
import type { RootStackParamList } from '../../app/navigation/types';
import { getPlayerDetail } from '../../application/services/historyRepository';
import type { PlayerDetail } from '../../domain/history/types';
import { formatDart } from './MatchDetailScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerDetail'>;

const TREND_HEIGHT = 96;

const formatDay = (createdAt: number) => {
  const date = new Date(createdAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const HIT_MAP_MAX_SIZE = 320;
const TOP_SEGMENTS = 3;

export const PlayerDetailScreen = ({ navigation, route }: Props) => {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { width } = useWindowDimensions();

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
  const dartsThrown = detail.segments.reduce((sum, segment) => sum + segment.count, 0);
  const misses = detail.segments.find(segment => segment.target === 'miss')?.count ?? 0;
  const topSegments = detail.segments
    .filter(segment => segment.target !== 'miss')
    .sort((left, right) => right.count - left.count)
    .slice(0, TOP_SEGMENTS);

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
          <X01StatBlock stats={detail.x01} />
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
          <StatTiles>
            <StatTile label="MPR（每轮平均记次）" value={detail.cricketMpr.toFixed(2)} />
          </StatTiles>
        </>
      ) : null}

      {dartsThrown > 0 ? (
        <>
          <Text style={styles.sectionTitle}>命中分布</Text>
          <View style={[styles.card, styles.hitMap]}>
            <HitMapBoard
              size={Math.min(HIT_MAP_MAX_SIZE, width - 72)}
              segments={detail.segments}
            />
            <Text style={styles.hitMapText}>
              共 {dartsThrown} 镖 · 脱靶 {formatRate(misses, dartsThrown)}
            </Text>
            {topSegments.length > 0 ? (
              <Text style={styles.hitMapText}>
                最常命中：
                {topSegments
                  .map(segment => `${formatDart(segment)} ${formatRate(segment.count, dartsThrown)}`)
                  .join(' · ')}
              </Text>
            ) : null}
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
          <Text style={styles.chevron} />
        </View>
        {detail.modes.map(mode => (
          <Pressable
            key={mode.mode}
            onPress={() =>
              navigation.navigate('PlayerMode', {
                playerId: detail.playerId,
                playerName: detail.name,
                mode: mode.mode,
                title: mode.modeLabel ?? mode.mode,
              })
            }
            style={({ pressed }) => [styles.tableRow, pressed && styles.pressed]}>
            <Text numberOfLines={1} style={styles.cellName}>
              {mode.modeLabel ?? mode.mode}
            </Text>
            <Text style={styles.cell}>{mode.matchesPlayed}</Text>
            <Text style={styles.cell}>{formatRate(mode.wins, mode.matchesPlayed)}</Text>
            <Text style={styles.cell}>{mode.bestScore ?? '—'}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.note}>
        X01 均分按每镖实际得分算，爆镖轮也计入。收镖成功率：剩下的分一镖就能收（2–40 的双数或 50）时投出的镖里，收镖成功的比例。最好成绩只算计分类玩法的个人赛。点玩法可看该玩法的详细数据和对局记录。
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
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
  },
  hitMap: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  hitMapText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
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
  chevron: {
    width: 14,
    fontSize: 18,
    textAlign: 'right',
    color: colors.textSecondary,
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
