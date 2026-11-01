import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, teamColors } from '../theme/colors';
import { ModeBar, ModeMenu } from '../components/ModePicker';
import { ShareButton } from '../components/ShareButton';
import { RECENT_DAYS, RangeSwitch, rangeStart } from './PlayerDetailScreen';
import type { StatsRange } from './PlayerDetailScreen';
import type { RootStackParamList } from '../../app/navigation/types';
import { getHeadToHead } from '../../application/services/historyRepository';
import type { HeadToHead, PlayerModeStats } from '../../domain/history/types';
import {
  compareRows,
  isAhead,
  type CompareRowData,
} from '../../domain/history/headToHeadCompare';

type Props = NativeStackScreenProps<RootStackParamList, 'HeadToHead'>;

const LEFT_COLOR = teamColors[0];
const RIGHT_COLOR = teamColors[1];
const RECENT_RESULTS = 10;
const GROW_DURATION = 700;

const modeTitle = (stats: PlayerModeStats) => stats.modeLabel ?? stats.mode;

const renderShare = (onPress: () => void) => () => (
  <ShareButton variant="header" color={colors.textPrimary} onPress={onPress} />
);

// Two bars growing out from the middle; the better side keeps its player's full color.
const CompareRow = ({
  row,
  grow,
}: {
  row: CompareRowData;
  grow: Animated.Value;
}) => {
  const largest = Math.max(Math.abs(row.left ?? 0), Math.abs(row.right ?? 0));
  const bar = (
    value: number | null,
    color: string,
    ahead: boolean,
    origin: 'left' | 'right',
  ) =>
    value === null || largest === 0 ? null : (
      <Animated.View
        style={[
          styles.bar,
          !ahead && styles.barBehind,
          {
            width: `${(Math.abs(value) / largest) * 100}%`,
            backgroundColor: color,
            transformOrigin: origin,
            transform: [{ scaleX: grow }],
          },
        ]}
      />
    );
  const leftAhead = isAhead(row, row.left, row.right);
  const rightAhead = isAhead(row, row.right, row.left);
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareLabel}>{row.label}</Text>
      <View style={styles.compareLine}>
        <Text
          style={[
            styles.compareValue,
            styles.valueLeft,
            leftAhead && styles.valueAhead,
          ]}
        >
          {row.left === null ? '—' : row.format(row.left)}
        </Text>
        <View style={[styles.barHalf, styles.barHalfLeft]}>
          {bar(row.left, LEFT_COLOR, leftAhead, 'right')}
        </View>
        <View style={styles.barMiddle} />
        <View style={styles.barHalf}>
          {bar(row.right, RIGHT_COLOR, rightAhead, 'left')}
        </View>
        <Text style={[styles.compareValue, rightAhead && styles.valueAhead]}>
          {row.right === null ? '—' : row.format(row.right)}
        </Text>
      </View>
    </View>
  );
};

// Every compared figure of a mode, the bars growing each time the card is shown.
const CompareCard = ({ rows }: { rows: CompareRowData[] }) => {
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, {
      toValue: 1,
      duration: GROW_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [grow]);
  return (
    <View style={[styles.card, styles.compareCard]}>
      {rows.map(row => (
        <CompareRow key={row.label} row={row} grow={grow} />
      ))}
    </View>
  );
};

export const HeadToHeadScreen = ({ navigation, route }: Props) => {
  const { playerId, opponentId } = route.params;
  const [record, setRecord] = useState<HeadToHead | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [range, setRange] = useState<StatsRange>('all');
  // null shows the overview.
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuTop, setMenuTop] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getHeadToHead(playerId, opponentId, rangeStart(range))
      .then(setRecord)
      .catch(() => setRecord(null))
      .finally(() => setLoaded(true));
  }, [playerId, opponentId, range]);

  // Title bar share button for what the page shows, once there is something to share.
  const hasResults = (record?.results.length ?? 0) > 0;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: hasResults
        ? renderShare(() =>
            navigation.navigate('SharePreview', {
              versus: { playerId, opponentId, range, mode: selectedMode },
            }),
          )
        : undefined,
    });
  }, [navigation, hasResults, playerId, opponentId, range, selectedMode]);

  if (!loaded) {
    return <Text style={styles.empty}>正在读取…</Text>;
  }
  if (!record) {
    return <Text style={styles.empty}>找不到这两个玩家。</Text>;
  }

  const { left, right, results } = record;
  const othersWon = results.filter(result => result.winner === 'other').length;
  const latest = results[0]?.winner;
  const streak =
    latest === 'left' || latest === 'right'
      ? results.findIndex(result => result.winner !== latest)
      : 0;
  const streakLength = streak === -1 ? results.length : streak;
  const recentResults = results.slice(0, RECENT_RESULTS).reverse();

  const selectedLeft =
    left.modes.find(mode => mode.mode === selectedMode) ?? null;
  const selectedRight =
    right.modes.find(mode => mode.mode === selectedMode) ?? null;
  const selectMode = (mode: string | null) => {
    setSelectedMode(mode);
    setMenuOpen(false);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const modeOptions = [
    { key: null, label: '总览', detail: `${left.matchesPlayed} 场` },
    ...left.modes.map(mode => ({
      key: mode.mode,
      label: modeTitle(mode),
      detail: `${mode.matchesPlayed} 场`,
    })),
  ];

  const nameButton = (
    playerName: string,
    id: number,
    color: string,
    align: 'left' | 'right',
  ) => (
    <Pressable
      hitSlop={6}
      onPress={() => navigation.push('PlayerDetail', { playerId: id })}
      style={({ pressed }) => [styles.side, pressed && styles.pressed]}
    >
      <Text
        numberOfLines={1}
        style={[styles.sideName, { color, textAlign: align }]}
      >
        {playerName}
      </Text>
    </Pressable>
  );

  const renderOverview = () => (
    <>
      <Text style={styles.sectionTitle}>各玩法</Text>
      <View style={styles.card}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.cellName, styles.headerText]}>玩法</Text>
          <Text style={[styles.cell, styles.headerText]}>场次</Text>
          <Text
            numberOfLines={1}
            style={[styles.cell, styles.headerText, { color: LEFT_COLOR }]}
          >
            {left.name}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.cell, styles.headerText, { color: RIGHT_COLOR }]}
          >
            {right.name}
          </Text>
          <Text style={styles.chevron} />
        </View>
        {left.modes.map(mode => (
          <Pressable
            key={mode.mode}
            onPress={() => selectMode(mode.mode)}
            style={({ pressed }) => [
              styles.tableRow,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={styles.cellName}>
              {modeTitle(mode)}
            </Text>
            <Text style={styles.cell}>{mode.matchesPlayed}</Text>
            <Text style={styles.cell}>{mode.wins}</Text>
            <Text style={styles.cell}>
              {right.modes.find(item => item.mode === mode.mode)?.wins ?? 0}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        表里是两人各自的胜场。点上面的玩法或表里的一行，逐项对比两人的数据。
      </Text>
    </>
  );

  const renderMode = (
    leftStats: PlayerModeStats,
    rightStats: PlayerModeStats,
  ) => (
    <>
      <CompareCard
        key={`${range}-${leftStats.mode}`}
        rows={compareRows(leftStats, rightStats)}
      />
      <Text style={styles.note}>
        颜色深的一方这一项更好。用镖、被减半次数越少越好。
        {leftStats.x01 ? '胜局用镖只算个人赛。' : ''}
      </Text>
    </>
  );

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
      <View style={[styles.card, styles.scoreCard]}>
        <View style={styles.scoreRow}>
          {nameButton(left.name, left.playerId, LEFT_COLOR, 'right')}
          <Text style={styles.score}>
            {left.wins} : {right.wins}
          </Text>
          {nameButton(right.name, right.playerId, RIGHT_COLOR, 'left')}
        </View>
        <Text style={styles.meta}>
          共 {results.length} 场
          {othersWon > 0 ? ` · ${othersWon} 场别人赢` : ''}
        </Text>
        {recentResults.length > 0 ? (
          <View style={styles.dots}>
            <Text style={styles.meta}>最近 {recentResults.length} 场</Text>
            {recentResults.map(result => (
              <View
                key={result.matchId}
                style={[
                  styles.dot,
                  result.winner === 'left' && {
                    backgroundColor: LEFT_COLOR,
                    borderColor: LEFT_COLOR,
                  },
                  result.winner === 'right' && {
                    backgroundColor: RIGHT_COLOR,
                    borderColor: RIGHT_COLOR,
                  },
                ]}
              />
            ))}
          </View>
        ) : null}
        {streakLength >= 2 ? (
          <Text style={styles.meta}>
            {latest === 'left' ? left.name : right.name} 当前 {streakLength}{' '}
            连胜
          </Text>
        ) : null}
      </View>

      <View style={styles.rangeRow}>
        <Text style={styles.meta}>只算两人对战的比赛</Text>
        <RangeSwitch range={range} onChange={setRange} />
      </View>

      {results.length === 0 ? (
        <Text style={styles.note}>最近 {RECENT_DAYS} 天两人没有对战。</Text>
      ) : (
        <>
          <View
            onLayout={event => {
              const { y, height } = event.nativeEvent.layout;
              setMenuTop(y + height + 4);
            }}
          >
            <ModeBar
              options={modeOptions}
              selectedKey={selectedLeft?.mode ?? null}
              menuOpen={menuOpen}
              onSelect={selectMode}
              onToggleMenu={() => setMenuOpen(open => !open)}
            />
          </View>

          {selectedLeft && selectedRight
            ? renderMode(selectedLeft, selectedRight)
            : renderOverview()}
        </>
      )}

      {menuOpen ? (
        <ModeMenu
          options={modeOptions}
          selectedKey={selectedLeft?.mode ?? null}
          top={menuTop}
          onSelect={selectMode}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
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
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
  },
  scoreCard: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  side: {
    flex: 1,
  },
  sideName: {
    fontSize: 18,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  score: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 4,
  },
  compareCard: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  compareRow: {
    paddingVertical: 6,
    gap: 4,
  },
  compareLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  compareLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compareValue: {
    width: 52,
    fontSize: 15,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  valueLeft: {
    textAlign: 'right',
    marginRight: 8,
  },
  valueAhead: {
    fontWeight: '800',
    color: colors.textPrimary,
  },
  barHalf: {
    flex: 1,
    height: 10,
    marginRight: 8,
  },
  barHalfLeft: {
    alignItems: 'flex-end',
    marginRight: 0,
  },
  barMiddle: {
    width: 2,
    height: 16,
    marginHorizontal: 2,
    backgroundColor: colors.border,
  },
  bar: {
    height: 10,
    borderRadius: 5,
  },
  barBehind: {
    opacity: 0.3,
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
