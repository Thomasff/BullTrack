import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { PlayerEditDialog } from '../components/PlayerEditDialog';
import { HitMapBoard } from '../components/HitMapBoard';
import { ModeBar, ModeMenu } from '../components/ModePicker';
import { StatTile, StatTiles, X01StatBlock, formatRate } from '../components/PlayerStatBlocks';
import type { RootStackParamList } from '../../app/navigation/types';
import { getPlayerDetail } from '../../application/services/historyRepository';
import type {
  PlayerDetail,
  PlayerModeMatch,
  PlayerModeStats,
  PlayerSegmentCount,
  PlayerTrendPoint,
} from '../../domain/history/types';
import { formatDart } from './MatchDetailScreen';
import { formatMatchTime } from './StatsTab';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerDetail'>;

const TREND_HEIGHT = 96;
// Bars grow one after another: each starts TREND_STAGGER later and grows for TREND_GROW,
// as shares of the whole animation.
const TREND_DURATION = 900;
const TREND_STAGGER = 0.04;
const TREND_GROW = 0.6;
const HIT_MAP_MAX_SIZE = 320;
const TOP_SEGMENTS = 3;

const formatDay = (createdAt: number) => {
  const date = new Date(createdAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const formatPercent = (share: number) => `${Math.round(share * 100)}%`;

const modeTitle = (stats: PlayerModeStats) => stats.modeLabel ?? stats.mode;

// Tiles for the figures a mode has besides X01 (which has its own block).
const modeTiles = (stats: PlayerModeStats) => {
  const tiles: Array<{ label: string; value: string }> = [
    { label: '场次', value: `${stats.matchesPlayed}` },
    { label: '胜率', value: formatRate(stats.wins, stats.matchesPlayed) },
  ];
  if (stats.bestScore !== null) {
    tiles.push({ label: '最好成绩', value: `${stats.bestScore}` });
  }
  if (stats.averageScore !== null) {
    tiles.push({ label: '平均成绩', value: stats.averageScore.toFixed(1) });
  }
  if (stats.cricket) {
    tiles.push(
      { label: 'MPR（每轮记次）', value: stats.cricket.mpr.toFixed(2) },
      { label: '前 9 镖 MPR', value: stats.cricket.first9Mpr.toFixed(2) },
      { label: '记 5 次以上的轮数', value: `${stats.cricket.count5Marks}` },
    );
  }
  if (stats.rounds) {
    tiles.push(
      { label: '每轮平均分', value: stats.rounds.average.toFixed(1) },
      { label: '最高单轮', value: `${stats.rounds.best}` },
    );
  }
  if (stats.darts99) {
    tiles.push(
      { label: '命中 20 区', value: formatPercent(stats.darts99.hitRate) },
      { label: '三倍 20', value: formatPercent(stats.darts99.tripleRate) },
      { label: '双倍 20', value: formatPercent(stats.darts99.doubleRate) },
    );
  }
  if (stats.aroundTheClock) {
    const finish = stats.aroundTheClock.dartsToFinish;
    tiles.push(
      { label: '命中当前目标', value: formatPercent(stats.aroundTheClock.hitRate) },
      { label: '最少用镖', value: finish ? `${finish.best}` : '—' },
      { label: '平均用镖', value: finish ? finish.average.toFixed(1) : '—' },
    );
  }
  if (stats.targetRounds) {
    tiles.push({ label: '命中本轮目标', value: formatPercent(stats.targetRounds.hitRate) });
    if (stats.mode === 'shanghai') {
      tiles.push({ label: 'Shanghai 次数', value: `${stats.targetRounds.shanghais}` });
    } else {
      tiles.push({
        label: '每局被减半次数',
        value: stats.targetRounds.halvedPerMatch.toFixed(1),
      });
    }
  }
  if (stats.checkoutDrill) {
    const drill = stats.checkoutDrill;
    tiles.push(
      {
        label: `收掉的数（${drill.finished}/${drill.attempted}）`,
        value: formatRate(drill.finished, drill.attempted),
      },
      {
        label: '收掉时平均用镖',
        value: drill.averageDarts !== null ? drill.averageDarts.toFixed(1) : '—',
      },
    );
  }
  return tiles;
};

const trendTitle = (stats: PlayerModeStats) => {
  if (stats.x01) {
    return '均分';
  }
  if (stats.cricket) {
    return 'MPR';
  }
  return stats.mode === 'aroundTheClock' ? '用镖（胜局）' : '得分';
};

const formatTrendValue = (value: number) =>
  value < 10 ? value.toFixed(1) : `${Math.round(value)}`;

const formatMatchResult = (match: PlayerModeMatch) => {
  if (match.score !== null) {
    return `${match.score} 分`;
  }
  return match.average !== null ? `均分 ${match.average.toFixed(1)}` : '';
};

const modeNote = (stats: PlayerModeStats) => {
  if (stats.x01) {
    return 'X01 均分按每镖实际得分算，爆镖轮也计入。收镖成功率：剩下的分一镖就能收（2–40 的双数或 50）时投出的镖里，收镖成功的比例。用镖只算个人赛的胜局。';
  }
  if (stats.aroundTheClock || stats.checkoutDrill) {
    return '只算个人赛。';
  }
  if (stats.bestScore !== null) {
    return '最好、平均成绩和走势只算个人赛。';
  }
  return null;
};

// The bars grow up from the bottom each time the chart is shown.
const TrendChart = ({ points }: { points: PlayerTrendPoint[] }) => {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: TREND_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const max = Math.max(...points.map(point => point.value), 0.001);
  return (
    <View style={[styles.card, styles.trend]}>
      {points.map((point, index) => {
        const start = Math.min(index * TREND_STAGGER, 1 - TREND_GROW);
        const grow = progress.interpolate({
          inputRange: [start, start + TREND_GROW],
          outputRange: [0.001, 1],
          extrapolate: 'clamp',
        });
        return (
          <View key={point.matchId} style={styles.trendColumn}>
            <Animated.Text style={[styles.trendValue, { opacity: grow }]}>
              {formatTrendValue(point.value)}
            </Animated.Text>
            <Animated.View
              style={[
                styles.trendBar,
                {
                  height: Math.max(2, (point.value / max) * TREND_HEIGHT),
                  transform: [{ scaleY: grow }],
                },
              ]}
            />
            <Text style={styles.trendDay}>{formatDay(point.createdAt)}</Text>
          </View>
        );
      })}
    </View>
  );
};

const HitMapCard = ({ segments, size }: { segments: PlayerSegmentCount[]; size: number }) => {
  const dartsThrown = segments.reduce((sum, segment) => sum + segment.count, 0);
  const misses = segments.find(segment => segment.target === 'miss')?.count ?? 0;
  const topSegments = segments
    .filter(segment => segment.target !== 'miss')
    .sort((left, right) => right.count - left.count)
    .slice(0, TOP_SEGMENTS);
  return (
    <View style={[styles.card, styles.hitMap]}>
      <HitMapBoard size={size} segments={segments} />
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
  );
};

export const PlayerDetailScreen = ({ navigation, route }: Props) => {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // null shows the overview.
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Bottom edge of the mode bar in the scroll content, where the dropdown opens.
  const [menuTop, setMenuTop] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
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

  const hitMapSize = Math.min(HIT_MAP_MAX_SIZE, width - 72);
  const selected = detail.modes.find(mode => mode.mode === selectedMode) ?? null;
  const selectMode = (mode: string | null) => {
    setSelectedMode(mode);
    setMenuOpen(false);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const modeOptions = [
    { key: null, label: '总览', detail: `${detail.matchesPlayed} 场` },
    ...detail.modes.map(mode => ({
      key: mode.mode,
      label: modeTitle(mode),
      detail: `${mode.matchesPlayed} 场`,
    })),
  ];

  const renderOverview = () => (
    <>
      {detail.segments.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>命中分布（全部玩法）</Text>
          <HitMapCard key="overview" segments={detail.segments} size={hitMapSize} />
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
            onPress={() => selectMode(mode.mode)}
            style={({ pressed }) => [styles.tableRow, pressed && styles.pressed]}>
            <Text numberOfLines={1} style={styles.cellName}>
              {modeTitle(mode)}
            </Text>
            <Text style={styles.cell}>{mode.matchesPlayed}</Text>
            <Text style={styles.cell}>{formatRate(mode.wins, mode.matchesPlayed)}</Text>
            <Text style={styles.cell}>{mode.bestScore ?? '—'}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.note}>
        点上面的玩法或表里的一行，看该玩法的详细数据和对局记录。最好成绩只算计分类玩法的个人赛。
      </Text>
    </>
  );

  const renderMode = (stats: PlayerModeStats) => {
    const note = modeNote(stats);
    return (
      <>
        <StatTiles>
          {modeTiles(stats).map(tile => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} />
          ))}
        </StatTiles>

        {stats.x01 ? <X01StatBlock stats={stats.x01} /> : null}

        {stats.trend.length >= 2 ? (
          <>
            <Text style={styles.sectionTitle}>
              最近 {stats.trend.length} 场{trendTitle(stats)}
            </Text>
            <TrendChart key={stats.mode} points={stats.trend} />
          </>
        ) : null}

        {stats.segments.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>命中分布</Text>
            <HitMapCard key={stats.mode} segments={stats.segments} size={hitMapSize} />
          </>
        ) : null}

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

        {note ? <Text style={styles.note}>{note}</Text> : null}
      </>
    );
  };

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
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

      <View
        onLayout={event => {
          const { y, height } = event.nativeEvent.layout;
          setMenuTop(y + height + 4);
        }}>
        <ModeBar
          options={modeOptions}
          selectedKey={selected?.mode ?? null}
          menuOpen={menuOpen}
          onSelect={selectMode}
          onToggleMenu={() => setMenuOpen(open => !open)}
        />
      </View>

      {selected ? renderMode(selected) : renderOverview()}

      {menuOpen ? (
        <ModeMenu
          options={modeOptions}
          selectedKey={selected?.mode ?? null}
          top={menuTop}
          onSelect={selectMode}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}

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
    transformOrigin: 'bottom',
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
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  note: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
