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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
import type { StatsRange } from '../../domain/share/statsCards';
import { ShareButton } from '../components/ShareButton';
import { formatDart } from './MatchDetailScreen';
import { formatMatchTime } from './MatchListScreen';
import { displayPlayerName } from '../../domain/game/players';
import { modeDisplayName } from '../../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerDetail'>;

const TREND_HEIGHT = 110;
// Room around the line so its dots are not cut off.
const TREND_PAD = 6;
const TREND_DURATION = 900;
// Up to this many days the line also shows a dot per day.
const TREND_MAX_DOTS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_DAYS = 30;

export type { StatsRange };
const RANGE_KEYS: StatsRange[] = ['all', 'recent'];

// The since argument of the stats queries for a range.
export const rangeStart = (range: StatsRange) =>
  range === 'recent' ? Date.now() - RECENT_DAYS * DAY_MS : null;

// The 30 days before the recent range, which the share card compares with.
export const previousRange = () => {
  const until = Date.now() - RECENT_DAYS * DAY_MS;
  return { since: until - RECENT_DAYS * DAY_MS, until };
};

export const RangeSwitch = ({
  range,
  onChange,
}: {
  range: StatsRange;
  onChange: (range: StatsRange) => void;
}) => {
  const { t } = useTranslation();
  return (
    <View style={styles.rangeSwitch}>
      {RANGE_KEYS.map(key => (
        <Pressable
          key={key}
          hitSlop={4}
          onPress={() => onChange(key)}
          style={[styles.rangeOption, range === key && styles.rangeOptionActive]}>
          <Text style={[styles.rangeLabel, range === key && styles.rangeLabelActive]}>
            {key === 'all' ? t('stats.rangeAll') : t('stats.rangeRecent', { days: RECENT_DAYS })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};
const HIT_MAP_MAX_SIZE = 320;
const TOP_SEGMENTS = 3;
const RECENT_MATCHES = 5;

const formatDay = (createdAt: number) => {
  const date = new Date(createdAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const formatPercent = (share: number) => `${Math.round(share * 100)}%`;

const modeTitle = (stats: PlayerModeStats) => modeDisplayName(stats.mode, stats.modeLabel);

// Tiles for the figures a mode has besides X01 (which has its own block).
const modeTiles = (stats: PlayerModeStats, t: TFunction) => {
  const tiles: Array<{ label: string; value: string }> = [
    { label: t('stats.figures.matches'), value: `${stats.matchesPlayed}` },
    { label: t('stats.figures.winRate'), value: formatRate(stats.wins, stats.matchesPlayed) },
  ];
  if (stats.bestScore !== null) {
    tiles.push({ label: t('stats.figures.bestScore'), value: `${stats.bestScore}` });
  }
  if (stats.averageScore !== null) {
    tiles.push({ label: t('stats.figures.averageScore'), value: stats.averageScore.toFixed(1) });
  }
  if (stats.cricket) {
    tiles.push(
      { label: t('stats.figures.mpr'), value: stats.cricket.mpr.toFixed(2) },
      { label: t('stats.figures.first9Mpr'), value: stats.cricket.first9Mpr.toFixed(2) },
    );
  }
  if (stats.rounds) {
    tiles.push(
      { label: t('stats.figures.roundAverage'), value: stats.rounds.average.toFixed(1) },
      { label: t('stats.figures.bestRound'), value: `${stats.rounds.best}` },
    );
  }
  if (stats.darts99) {
    tiles.push(
      { label: t('stats.figures.hit20'), value: formatPercent(stats.darts99.hitRate) },
      { label: t('stats.figures.treble20'), value: formatPercent(stats.darts99.tripleRate) },
      { label: t('stats.figures.double20'), value: formatPercent(stats.darts99.doubleRate) },
    );
  }
  if (stats.aroundTheClock) {
    const finish = stats.aroundTheClock.dartsToFinish;
    tiles.push(
      { label: t('stats.figures.targetHit'), value: formatPercent(stats.aroundTheClock.hitRate) },
      { label: t('stats.figures.fewestDarts'), value: finish ? `${finish.best}` : '—' },
      { label: t('stats.figures.averageDarts'), value: finish ? finish.average.toFixed(1) : '—' },
    );
  }
  if (stats.targetRounds) {
    tiles.push({ label: t('stats.figures.roundTargetHit'), value: formatPercent(stats.targetRounds.hitRate) });
    if (stats.mode === 'shanghai') {
      tiles.push({ label: t('stats.figures.shanghais'), value: `${stats.targetRounds.shanghais}` });
    } else {
      tiles.push({
        label: t('stats.figures.halvedPerMatch'),
        value: stats.targetRounds.halvedPerMatch.toFixed(1),
      });
    }
  }
  if (stats.checkoutDrill) {
    const drill = stats.checkoutDrill;
    tiles.push(
      {
        label: t('stats.figureWithCount', {
          label: t('stats.figures.finishes'),
          hits: drill.finished,
          attempts: drill.attempted,
        }),
        value: formatRate(drill.finished, drill.attempted),
      },
      {
        label: t('stats.figures.dartsPerFinish'),
        value: drill.averageDarts !== null ? drill.averageDarts.toFixed(1) : '—',
      },
    );
  }
  return tiles;
};

const trendTitle = (stats: PlayerModeStats, t: TFunction) => {
  if (stats.x01) {
    return t('stats.trendTitle.average');
  }
  if (stats.cricket) {
    return 'MPR';
  }
  return stats.mode === 'aroundTheClock' ? t('stats.trendTitle.darts') : t('stats.trendTitle.score');
};

const formatTrendValue = (value: number) =>
  value < 10 ? value.toFixed(1) : `${Math.round(value)}`;

const formatMatchResult = (match: PlayerModeMatch, t: TFunction) => {
  if (match.score !== null) {
    return t('stats.scorePoints', { score: match.score });
  }
  return match.average !== null ? t('stats.averageResult', { average: match.average.toFixed(1) }) : '';
};

const modeNote = (stats: PlayerModeStats, t: TFunction) => {
  if (stats.x01) {
    return t('stats.notes.x01');
  }
  if (stats.aroundTheClock || stats.checkoutDrill) {
    return t('stats.notes.soloOnly');
  }
  if (stats.bestScore !== null) {
    return t('stats.notes.scoreSoloOnly');
  }
  return null;
};

// The days as a line, uncovered from left to right each time the chart is shown.
const TrendLine = ({ points }: { points: PlayerTrendPoint[] }) => {
  const { t } = useTranslation();
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
        {t('stats.trendSummary', {
          last: formatTrendValue(values[values.length - 1]),
          max: formatTrendValue(max),
          min: formatTrendValue(min),
        })}
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
  const { t } = useTranslation();
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
        {t('stats.hitMapSummary', { darts: dartsThrown, rate: formatRate(misses, dartsThrown) })}
      </Text>
      {topSegments.length > 0 ? (
        <Text style={styles.hitMapText}>
          {t('stats.mostHit', {
            segments: topSegments
              .map(segment => `${formatDart(segment)} ${formatRate(segment.count, dartsThrown)}`)
              .join(' · '),
          })}
        </Text>
      ) : null}
      {partialLanding ? (
        <Text style={styles.hitMapText}>{t('stats.partialLanding', { n: points.length })}</Text>
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
  const { t } = useTranslation();
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
    return <Text style={styles.empty}>{t('history.loading')}</Text>;
  }
  if (!detail) {
    return <Text style={styles.empty}>{t('stats.playerNotFound')}</Text>;
  }

  const hitMapSize = Math.min(HIT_MAP_MAX_SIZE, width - 72);
  const selected = detail.modes.find(mode => mode.mode === selectedMode) ?? null;
  const selectMode = (mode: string | null) => {
    setSelectedMode(mode);
    setMenuOpen(false);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const modeOptions = [
    { key: null, label: t('stats.overview'), detail: t('stats.matchCount', { n: detail.matchesPlayed }) },
    ...detail.modes.map(mode => ({
      key: mode.mode,
      label: modeTitle(mode),
      detail: t('stats.matchCount', { n: mode.matchesPlayed }),
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
          <Text style={styles.sectionTitle}>{t('stats.sections.hitMapAll')}</Text>
          <HitMapCard
            key={`${range}-overview`}
            segments={detail.segments}
            points={detail.points}
            size={hitMapSize}
          />
        </>
      ) : null}

      <Text style={styles.sectionTitle}>{t('stats.sections.recentMatches')}</Text>
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
              {match.isWinner ? t('stats.won') : t('stats.lost')}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => navigation.navigate('MatchList')}
          style={({ pressed }) => [styles.matchRow, styles.allMatches, pressed && styles.pressed]}>
          <Text style={styles.allMatchesLabel}>{t('stats.sections.allMatchesAllPlayers')}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>{t('stats.sections.byMode')}</Text>
      <View style={styles.card}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.cellName, styles.headerText]}>{t('stats.columns.mode')}</Text>
          <Text style={[styles.cell, styles.headerText]}>{t('stats.columns.matches')}</Text>
          <Text style={[styles.cell, styles.headerText]}>{t('stats.columns.winRate')}</Text>
          <Text style={[styles.cell, styles.headerText]}>{t('stats.columns.bestScore')}</Text>
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

      <Text style={styles.note}>{t('stats.notes.overview')}</Text>

      {detail.opponents.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>{t('stats.sections.opponents')}</Text>
          <View style={styles.card}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.cellName, styles.headerText]}>{t('stats.columns.opponent')}</Text>
              <Text style={[styles.cell, styles.headerText]}>{t('stats.columns.matches')}</Text>
              <Text style={[styles.cell, styles.headerText]}>{t('stats.columns.wins')}</Text>
              <Text style={[styles.cell, styles.headerText]}>{t('stats.columns.losses')}</Text>
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
                  {displayPlayerName(opponent.name)}
                </Text>
                <Text style={styles.cell}>{opponent.played}</Text>
                <Text style={[styles.cell, styles.won]}>{opponent.wins}</Text>
                <Text style={styles.cell}>{opponent.losses}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>{t('stats.notes.opponents')}</Text>
        </>
      ) : null}
    </>
  );

  const renderMode = (stats: PlayerModeStats) => {
    const note = modeNote(stats, t);
    return (
      <>
        <StatTiles>
          {modeTiles(stats, t).map(tile => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} />
          ))}
        </StatTiles>

        {stats.x01 ? <X01StatBlock stats={stats.x01} /> : null}
        {stats.cricket ? <CricketMarkRounds stats={stats.cricket} /> : null}

        {stats.trend.length >= 2 ? (
          <>
            <Text style={styles.sectionTitle}>
              {t('stats.sections.trend', { title: trendTitle(stats, t), days: stats.trend.length })}
            </Text>
            <TrendLine key={`${range}-${stats.mode}`} points={stats.trend} />
          </>
        ) : null}

        {stats.segments.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>{t('stats.sections.hitMap')}</Text>
            <HitMapCard
              key={`${range}-${stats.mode}`}
              segments={stats.segments}
              points={stats.points}
              size={hitMapSize}
            />
          </>
        ) : null}

        <Text style={styles.sectionTitle}>{t('stats.sections.matches')}</Text>
        <View style={styles.card}>
          {stats.matches.map(match => (
            <Pressable
              key={match.matchId}
              onPress={() => navigation.navigate('MatchDetail', { matchId: match.matchId })}
              style={({ pressed }) => [styles.matchRow, pressed && styles.pressed]}>
              <Text style={styles.matchTime}>{formatMatchTime(match.createdAt)}</Text>
              <Text style={styles.matchResult}>{formatMatchResult(match, t)}</Text>
              <Text style={[styles.matchOutcome, match.isWinner && styles.won]}>
                {match.isWinner ? t('stats.won') : t('stats.lost')}
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
                {displayPlayerName(detail.name)}
              </Text>
              <Text style={styles.playerSwitchArrow}>▾</Text>
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={styles.name}>
              {displayPlayerName(detail.name)}
            </Text>
          )}
          {detail.matchesPlayed > 0 ? (
            <ShareButton
              variant="header"
              color={colors.textPrimary}
              onPress={() =>
                navigation.navigate('SharePreview', {
                  player: { playerId: detail.playerId, range, mode: selected?.mode ?? null },
                })
              }
            />
          ) : null}
          <Pressable
            hitSlop={8}
            onPress={() => setEditing(true)}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
            <Text style={styles.editLabel}>{t('stats.edit')}</Text>
          </Pressable>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.meta}>
            {t('stats.summary', {
              played: detail.matchesPlayed,
              wins: detail.wins,
              rate: formatRate(detail.wins, detail.matchesPlayed),
            })}
          </Text>
          <RangeSwitch range={range} onChange={setRange} />
        </View>
      </View>

      {detail.matchesPlayed === 0 ? (
        <Text style={styles.note}>{t('stats.noRecentMatches', { days: RECENT_DAYS })}</Text>
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
