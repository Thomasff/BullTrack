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
import { useNavigation } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme/colors';
import { PlayerEditDialog } from '../components/PlayerEditDialog';
import { HitMapBoard, usesLandingPoints } from '../components/HitMapBoard';
import { ModeBar, ModeMenu } from '../components/ModePicker';
import {
  CricketMarkRounds,
  StatTile,
  StatTiles,
  X01StatBlock,
  formatRate,
} from '../components/PlayerStatBlocks';
import type { RootStackParamList } from '../../app/navigation/types';
import { getPlayerDetail } from '../../application/services/historyRepository';
import type {
  PlayerDetail,
  PlayerModeMatch,
  PlayerModeStats,
  PlayerSegmentCount,
  PlayerTrendPoint,
} from '../../domain/history/types';
import type { BoardPoint } from '../../domain/game/boardGeometry';
import { formatDart } from './MatchDetailScreen';
import { formatMatchTime } from './MatchListScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerDetail'>;

const TREND_HEIGHT = 110;
// Room around the line so its dots are not cut off.
const TREND_PAD = 6;
const TREND_DURATION = 900;
// Up to this many days the line also shows a dot per day.
const TREND_MAX_DOTS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_DAYS = 30;

export type StatsRange = 'all' | 'recent';
const RANGE_OPTIONS: Array<{ key: StatsRange; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'recent', label: `近 ${RECENT_DAYS} 天` },
];

// The since argument of the stats queries for a range.
export const rangeStart = (range: StatsRange) =>
  range === 'recent' ? Date.now() - RECENT_DAYS * DAY_MS : null;

export const RangeSwitch = ({
  range,
  onChange,
}: {
  range: StatsRange;
  onChange: (range: StatsRange) => void;
}) => (
  <View style={styles.rangeSwitch}>
    {RANGE_OPTIONS.map(option => (
      <Pressable
        key={option.key}
        hitSlop={4}
        onPress={() => onChange(option.key)}
        style={[styles.rangeOption, range === option.key && styles.rangeOptionActive]}>
        <Text style={[styles.rangeLabel, range === option.key && styles.rangeLabelActive]}>
          {option.label}
        </Text>
      </Pressable>
    ))}
  </View>
);
const HIT_MAP_MAX_SIZE = 320;
const TOP_SEGMENTS = 3;
const RECENT_MATCHES = 5;

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

// The days as a line, uncovered from left to right each time the chart is shown.
const TrendLine = ({ points }: { points: PlayerTrendPoint[] }) => {
  const [width, setWidth] = useState(0);
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (width > 0) {
      Animated.timing(reveal, {
        toValue: 1,
        duration: TREND_DURATION,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [reveal, width]);

  const values = points.map(point => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const xAt = (index: number) =>
    TREND_PAD + (index / (points.length - 1)) * (width - 2 * TREND_PAD);
  const yAt = (value: number) =>
    TREND_PAD + (max === min ? 0.5 : (max - value) / (max - min)) * (TREND_HEIGHT - 2 * TREND_PAD);
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(1)} ${yAt(point.value).toFixed(1)}`)
    .join(' ');
  const area = `${line} L ${xAt(points.length - 1).toFixed(1)} ${TREND_HEIGHT} L ${xAt(0).toFixed(1)} ${TREND_HEIGHT} Z`;

  return (
    <View style={[styles.card, styles.trend]}>
      <Text style={styles.trendSummary}>
        最近一天 {formatTrendValue(values[values.length - 1])} · 最高 {formatTrendValue(max)} · 最低{' '}
        {formatTrendValue(min)}
      </Text>
      <View
        style={styles.trendPlot}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <>
            <Svg width={width} height={TREND_HEIGHT}>
              <Path d={area} fill={colors.accent} fillOpacity={0.12} />
              <Path
                d={line}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.length <= TREND_MAX_DOTS
                ? points.map((point, index) => (
                    <Circle
                      key={point.day}
                      cx={xAt(index)}
                      cy={yAt(point.value)}
                      r={3}
                      fill={colors.accent}
                    />
                  ))
                : null}
            </Svg>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.trendCover,
                {
                  transform: [
                    { translateX: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) },
                  ],
                },
              ]}
            />
          </>
        ) : null}
      </View>
      <View style={styles.trendDays}>
        <Text style={styles.trendDay}>{formatDay(points[0].day)}</Text>
        <Text style={styles.trendDay}>{formatDay(points[points.length - 1].day)}</Text>
      </View>
    </View>
  );
};

const HitMapCard = ({
  segments,
  points,
  size,
}: {
  segments: PlayerSegmentCount[];
  points: BoardPoint[];
  size: number;
}) => {
  const dartsThrown = segments.reduce((sum, segment) => sum + segment.count, 0);
  const misses = segments.find(segment => segment.target === 'miss')?.count ?? 0;
  // Older, hand-placed and guessed darts have no landing point.
  const partialLanding = usesLandingPoints(points) && points.length < dartsThrown - misses;
  const topSegments = segments
    .filter(segment => segment.target !== 'miss')
    .sort((left, right) => right.count - left.count)
    .slice(0, TOP_SEGMENTS);
  return (
    <View style={[styles.card, styles.hitMap]}>
      <HitMapBoard size={size} segments={segments} points={points} />
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
      {partialLanding ? (
        <Text style={styles.hitMapText}>落点图按记下落点的 {points.length} 镖画</Text>
      ) : null}
    </View>
  );
};

// One player's stats page; the stats tab shows it with a player switch on the name.
export const PlayerStatsView = ({
  playerId,
  onPickPlayer,
  onRenamed,
  onPlayerGone,
}: {
  playerId: number;
  // Set when the name should open a list to pick another player.
  onPickPlayer?: () => void;
  onRenamed?: () => void;
  // After the player was merged into another or deleted.
  onPlayerGone: () => void;
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [range, setRange] = useState<StatsRange>('all');
  // null shows the overview.
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Bottom edge of the mode bar in the scroll content, where the dropdown opens.
  const [menuTop, setMenuTop] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();

  useEffect(() => {
    getPlayerDetail(playerId, rangeStart(range))
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoaded(true));
  }, [playerId, reloadKey, range]);

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
  const recentMatches = detail.modes
    .flatMap(stats => stats.matches.map(match => ({ match, stats })))
    .sort((left, right) => right.match.createdAt - left.match.createdAt)
    .slice(0, RECENT_MATCHES);

  const renderOverview = () => (
    <>
      {detail.segments.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>命中分布（全部玩法）</Text>
          <HitMapCard
            key={`${range}-overview`}
            segments={detail.segments}
            points={detail.points}
            size={hitMapSize}
          />
        </>
      ) : null}

      <Text style={styles.sectionTitle}>最近比赛</Text>
      <View style={styles.card}>
        {recentMatches.map(({ match, stats }) => (
          <Pressable
            key={match.matchId}
            onPress={() => navigation.navigate('MatchDetail', { matchId: match.matchId })}
            style={({ pressed }) => [styles.matchRow, pressed && styles.pressed]}>
            <Text style={styles.matchTime}>{formatMatchTime(match.createdAt)}</Text>
            <Text numberOfLines={1} style={styles.matchMode}>
              {modeTitle(stats)}
            </Text>
            <Text style={[styles.matchOutcome, match.isWinner && styles.won]}>
              {match.isWinner ? '胜' : '负'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => navigation.navigate('MatchList')}
          style={({ pressed }) => [styles.matchRow, styles.allMatches, pressed && styles.pressed]}>
          <Text style={styles.allMatchesLabel}>全部比赛（所有玩家）</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

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

      {detail.opponents.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>对战记录</Text>
          <View style={styles.card}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.cellName, styles.headerText]}>对手</Text>
              <Text style={[styles.cell, styles.headerText]}>场次</Text>
              <Text style={[styles.cell, styles.headerText]}>胜</Text>
              <Text style={[styles.cell, styles.headerText]}>负</Text>
              <Text style={styles.chevron} />
            </View>
            {detail.opponents.map(opponent => (
              <Pressable
                key={opponent.playerId}
                onPress={() =>
                  navigation.push('HeadToHead', {
                    playerId: detail.playerId,
                    opponentId: opponent.playerId,
                  })
                }
                style={({ pressed }) => [styles.tableRow, pressed && styles.pressed]}>
                <Text numberOfLines={1} style={styles.cellName}>
                  {opponent.name}
                </Text>
                <Text style={styles.cell}>{opponent.played}</Text>
                <Text style={[styles.cell, styles.won]}>{opponent.wins}</Text>
                <Text style={styles.cell}>{opponent.losses}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>
            队友不算对手；多人局里由别人获胜的场次只计入场次。点一行看两人对比。
          </Text>
        </>
      ) : null}
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
        {stats.cricket ? <CricketMarkRounds stats={stats.cricket} /> : null}

        {stats.trend.length >= 2 ? (
          <>
            <Text style={styles.sectionTitle}>
              {trendTitle(stats)}走势（按天，共 {stats.trend.length} 天）
            </Text>
            <TrendLine key={`${range}-${stats.mode}`} points={stats.trend} />
          </>
        ) : null}

        {stats.segments.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>命中分布</Text>
            <HitMapCard
              key={`${range}-${stats.mode}`}
              segments={stats.segments}
              points={stats.points}
              size={hitMapSize}
            />
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
        <View style={styles.summaryRow}>
          {onPickPlayer ? (
            <Pressable
              onPress={onPickPlayer}
              style={({ pressed }) => [styles.playerSwitch, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.playerSwitchName}>
                {detail.name}
              </Text>
              <Text style={styles.playerSwitchArrow}>▾</Text>
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={styles.name}>
              {detail.name}
            </Text>
          )}
          <Pressable
            hitSlop={8}
            onPress={() => setEditing(true)}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
            <Text style={styles.editLabel}>编辑</Text>
          </Pressable>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.meta}>
            {detail.matchesPlayed} 场 · 胜 {detail.wins} 场 · 胜率{' '}
            {formatRate(detail.wins, detail.matchesPlayed)}
          </Text>
          <RangeSwitch range={range} onChange={setRange} />
        </View>
      </View>

      {detail.matchesPlayed === 0 ? (
        <Text style={styles.note}>最近 {RECENT_DAYS} 天没有比赛。</Text>
      ) : (
        <>
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
        </>
      )}

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
            onRenamed?.();
          } else {
            onPlayerGone();
          }
        }}
      />
    </ScrollView>
  );
};

export const PlayerDetailScreen = ({ navigation, route }: Props) => (
  <PlayerStatsView playerId={route.params.playerId} onPlayerGone={() => navigation.goBack()} />
);

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
    gap: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  name: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  meta: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
  },
  rangeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.panelStrong,
    borderRadius: 10,
    padding: 2,
  },
  rangeOption: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rangeOptionActive: {
    backgroundColor: colors.panel,
  },
  rangeLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  rangeLabelActive: {
    fontWeight: '700',
    color: colors.textPrimary,
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
  playerSwitch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  playerSwitchName: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  playerSwitchArrow: {
    marginLeft: 'auto',
    fontSize: 18,
    color: colors.accent,
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
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  trendSummary: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  trendPlot: {
    height: TREND_HEIGHT,
    overflow: 'hidden',
  },
  trendCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.panel,
  },
  trendDays: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  matchMode: {
    maxWidth: '45%',
    fontSize: 14,
    color: colors.textSecondary,
  },
  allMatches: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  allMatchesLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
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
