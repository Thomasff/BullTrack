import type { BoardPoint } from '../game/boardGeometry';
import type {
  HeadToHead,
  PlayerDetail,
  PlayerModeStats,
  PlayerSegmentCount,
  PlayerTrendPoint,
} from '../history/types';
import { compareRows, isAhead } from '../history/headToHeadCompare';
import { modeName, playerLabel, type ShareLanguage } from './shareCards';

export type StatsRange = 'all' | 'recent';

// A figure's change since the 30 days before, as an arrow and the difference.
export interface FigureChange {
  text: string;
  better: boolean;
}

export interface CardFigure {
  label: string;
  value: string;
  change: FigureChange | null;
}

type ValueKind = 'percent' | 'one' | 'two' | 'whole';

// Card labels are written in Chinese; these are their English versions.
const LABELS_EN: Record<string, string> = {
  场次: 'Matches',
  胜场: 'Wins',
  胜率: 'Win rate',
  脱靶率: 'Miss rate',
  三镖均分: '3-dart avg',
  '前 9 镖均分': 'First 9 avg',
  收镖成功率: 'Checkout %',
  最高收镖: 'Best checkout',
  '180 次数': '180s',
  胜局平均用镖: 'Darts / win',
  MPR: 'MPR',
  'MPR（每轮记次）': 'MPR',
  '前 9 镖 MPR': 'First 9 MPR',
  最好成绩: 'Best score',
  平均成绩: 'Avg score',
  每轮平均分: 'Avg / round',
  最高单轮: 'Best round',
  '命中 20 区': '20s hit',
  '三倍 20': 'Treble 20',
  命中当前目标: 'Target hit',
  最少用镖: 'Fewest darts',
  平均用镖: 'Avg darts',
  命中本轮目标: 'Target hit',
  'Shanghai 次数': 'Shanghais',
  每局被减半次数: 'Halved / match',
  收掉的数: 'Finishes',
  收掉时平均用镖: 'Darts / finish',
};

const label = (zh: string, language: ShareLanguage) =>
  language === 'en' ? LABELS_EN[zh] ?? zh : zh;

const TEXT = {
  stats: { zh: '统计', en: 'Stats' },
  versus: { zh: '对战', en: 'Head to head' },
  all: { zh: '全部', en: 'All time' },
  recent: { zh: '近 30 天', en: 'Last 30 days' },
  player: { zh: '玩家', en: 'Player' },
  changes: { zh: '箭头：和再往前 30 天比', en: 'Arrows: vs the 30 days before' },
  darts: { zh: (n: number) => `共 ${n} 镖`, en: (n: number) => `${n} darts` },
  mostHit: { zh: '最常命中', en: 'Most hit' },
  played: { zh: (n: number) => `共 ${n} 场`, en: (n: number) => `${n} matches` },
  othersWon: { zh: (n: number) => `${n} 场别人赢`, en: (n: number) => `${n} won by others` },
  streak: {
    zh: (name: string, n: number) => `${name} 当前 ${n} 连胜`,
    en: (name: string, n: number) => `${name}: ${n} wins in a row`,
  },
  moreModes: { zh: (n: number) => `另有 ${n} 种玩法`, en: (n: number) => `+${n} more modes` },
  mode: { zh: '玩法', en: 'Mode' },
};

export const statsText = {
  changes: (language: ShareLanguage) => TEXT.changes[language],
  mode: (language: ShareLanguage) => TEXT.mode[language],
  moreModes: (n: number, language: ShareLanguage) => TEXT.moreModes[language](n),
};

const formatValue = (kind: ValueKind, value: number) => {
  switch (kind) {
    case 'percent':
      return `${Math.round(value * 100)}%`;
    case 'one':
      return value.toFixed(1);
    case 'two':
      return value.toFixed(2);
    default:
      return `${Math.round(value)}`;
  }
};

// Percent figures change by points; null when the change rounds to nothing.
const formatChange = (kind: ValueKind, now: number, before: number, lowerIsBetter: boolean) => {
  const diff = now - before;
  const size = kind === 'percent' ? `${Math.round(Math.abs(diff) * 100)}` : formatValue(kind, Math.abs(diff));
  if (Number(size) === 0) {
    return null;
  }
  return { text: `${diff > 0 ? '↑' : '↓'}${size}`, better: lowerIsBetter ? diff < 0 : diff > 0 };
};

const share = (hits: number, attempts: number) => (attempts > 0 ? hits / attempts : null);

interface FigureSpec<T> {
  label: string;
  kind: ValueKind;
  get: (stats: T) => number | null | undefined;
  lowerIsBetter?: boolean;
  // Whether the card shows its change since the 30 days before.
  tracked?: boolean;
}

// The spec's figure, or null when the player has none; before is the same stats over the
// previous 30 days, when the card compares.
const toFigure = <T>(spec: FigureSpec<T>, stats: T, before: T | null, language: ShareLanguage) => {
  const value = spec.get(stats);
  if (value === null || value === undefined) {
    return null;
  }
  const previous = spec.tracked && before ? spec.get(before) : null;
  return {
    label: label(spec.label, language),
    value: formatValue(spec.kind, value),
    change:
      previous === null || previous === undefined
        ? null
        : formatChange(spec.kind, value, previous, spec.lowerIsBetter ?? false),
  };
};

const missRate = (segments: PlayerSegmentCount[]) => {
  const thrown = segments.reduce((sum, segment) => sum + segment.count, 0);
  return share(segments.find(segment => segment.target === 'miss')?.count ?? 0, thrown);
};

const winRate = (stats: { wins: number; matchesPlayed: number }) => share(stats.wins, stats.matchesPlayed);

const WIN_RATE: FigureSpec<PlayerModeStats> = { label: '胜率', kind: 'percent', get: winRate, tracked: true };
const MATCHES: FigureSpec<PlayerModeStats> = { label: '场次', kind: 'whole', get: stats => stats.matchesPlayed };

// A mode card's figures, the main one first.
const modeSpecs = (stats: PlayerModeStats): Array<FigureSpec<PlayerModeStats>> => {
  if (stats.x01) {
    return [
      { label: '三镖均分', kind: 'one', get: s => s.x01?.average, tracked: true },
      { label: '前 9 镖均分', kind: 'one', get: s => s.x01?.first9Average, tracked: true },
      {
        label: '收镖成功率',
        kind: 'percent',
        get: s => s.x01 && share(s.x01.checkoutHits, s.x01.checkoutAttempts),
        tracked: true,
      },
      { label: '最高收镖', kind: 'whole', get: s => s.x01?.bestCheckout },
      { label: '180 次数', kind: 'whole', get: s => s.x01?.count180 },
    ];
  }
  if (stats.cricket) {
    return [
      { label: 'MPR', kind: 'two', get: s => s.cricket?.mpr, tracked: true },
      { label: '前 9 镖 MPR', kind: 'two', get: s => s.cricket?.first9Mpr, tracked: true },
      WIN_RATE,
      MATCHES,
    ];
  }
  if (stats.aroundTheClock) {
    return [
      { label: '命中当前目标', kind: 'percent', get: s => s.aroundTheClock?.hitRate, tracked: true },
      { label: '最少用镖', kind: 'whole', get: s => s.aroundTheClock?.dartsToFinish?.best },
      {
        label: '平均用镖',
        kind: 'one',
        get: s => s.aroundTheClock?.dartsToFinish?.average,
        lowerIsBetter: true,
        tracked: true,
      },
      WIN_RATE,
    ];
  }
  if (stats.bestScore === null) {
    // Killer, Gotcha 301, Random Cricket, or a scoring mode played only in teams.
    return [WIN_RATE, MATCHES];
  }
  const specs: Array<FigureSpec<PlayerModeStats>> = [
    { label: '最好成绩', kind: 'whole', get: s => s.bestScore },
    { label: '平均成绩', kind: 'one', get: s => s.averageScore, tracked: true },
  ];
  if (stats.rounds) {
    specs.push(
      { label: '每轮平均分', kind: 'one', get: s => s.rounds?.average, tracked: true },
      { label: '最高单轮', kind: 'whole', get: s => s.rounds?.best },
    );
  }
  if (stats.darts99) {
    specs.push(
      { label: '命中 20 区', kind: 'percent', get: s => s.darts99?.hitRate, tracked: true },
      { label: '三倍 20', kind: 'percent', get: s => s.darts99?.tripleRate },
    );
  }
  if (stats.targetRounds) {
    specs.push(
      { label: '命中本轮目标', kind: 'percent', get: s => s.targetRounds?.hitRate, tracked: true },
      stats.mode === 'shanghai'
        ? { label: 'Shanghai 次数', kind: 'whole', get: s => s.targetRounds?.shanghais }
        : {
            label: '每局被减半次数',
            kind: 'one',
            get: s => s.targetRounds?.halvedPerMatch,
            lowerIsBetter: true,
          },
    );
  }
  if (stats.checkoutDrill) {
    specs.push(
      {
        label: '收掉的数',
        kind: 'percent',
        get: s => s.checkoutDrill && share(s.checkoutDrill.finished, s.checkoutDrill.attempted),
        tracked: true,
      },
      { label: '收掉时平均用镖', kind: 'one', get: s => s.checkoutDrill?.averageDarts },
    );
  }
  specs.push(MATCHES);
  return specs;
};

const TREND_TITLES = {
  x01: { zh: '均分走势（按天）', en: 'Average by day' },
  cricket: { zh: 'MPR 走势（按天）', en: 'MPR by day' },
  aroundTheClock: { zh: '胜局用镖走势（按天）', en: 'Darts per win by day' },
  score: { zh: '得分走势（按天）', en: 'Score by day' },
};

const trendTitle = (stats: PlayerModeStats, language: ShareLanguage) => {
  const key = stats.x01 ? 'x01' : stats.cricket ? 'cricket' : stats.mode === 'aroundTheClock' ? 'aroundTheClock' : 'score';
  return TREND_TITLES[key][language];
};

const segmentName = (segment: PlayerSegmentCount, language: ShareLanguage) => {
  if (segment.target === 'IB') {
    return language === 'en' ? 'Bull' : '内牛';
  }
  if (segment.target === 'OB') {
    return language === 'en' ? '25' : '外牛';
  }
  return segment.multiplier === 3
    ? `T${segment.target}`
    : segment.multiplier === 2
      ? `D${segment.target}`
      : segment.target;
};

const TOP_SEGMENTS = 3;
// Main figure plus the grid under it.
const MODE_FIGURES = 5;

const rangeLabel = (range: StatsRange, language: ShareLanguage) => TEXT[range][language];

export interface PlayerStatsShare {
  name: string;
  // "统计 · 近 30 天" or "501 · 近 30 天".
  subtitle: string;
  // The mode card's big figure; null on the overview.
  main: CardFigure | null;
  figures: CardFigure[];
  // Whether any figure shows a change, which the card then explains.
  hasChanges: boolean;
  // Overview only: darts thrown and the most hit segments, and the hit map.
  hitLine: string | null;
  segments: PlayerSegmentCount[];
  points: BoardPoint[];
  trend: PlayerTrendPoint[];
  trendTitle: string | null;
}

// The player card for the overview (mode null) or one mode; previous is the same player over
// the 30 days before the range, given only for the last 30 days.
export const summarizePlayerStats = (
  detail: PlayerDetail,
  previous: PlayerDetail | null,
  mode: string | null,
  range: StatsRange,
  options: { language: ShareLanguage; showNames: boolean },
): PlayerStatsShare => {
  const { language, showNames } = options;
  const name = showNames ? detail.name : TEXT.player[language];
  const stats = mode === null ? null : detail.modes.find(item => item.mode === mode) ?? null;
  if (!stats) {
    const overviewSpecs: Array<FigureSpec<PlayerDetail>> = [
      { label: '场次', kind: 'whole', get: s => s.matchesPlayed },
      { label: '胜率', kind: 'percent', get: winRate, tracked: true },
      { label: '脱靶率', kind: 'percent', get: s => missRate(s.segments), lowerIsBetter: true, tracked: true },
    ];
    const figures = overviewSpecs
      .map(spec => toFigure(spec, detail, previous, language))
      .filter(figure => figure !== null);
    const thrown = detail.segments.reduce((sum, segment) => sum + segment.count, 0);
    const top = detail.segments
      .filter(segment => segment.target !== 'miss')
      .sort((left, right) => right.count - left.count)
      .slice(0, TOP_SEGMENTS)
      .map(segment => segmentName(segment, language));
    return {
      name,
      subtitle: `${TEXT.stats[language]} · ${rangeLabel(range, language)}`,
      main: null,
      figures,
      hasChanges: figures.some(figure => figure.change !== null),
      hitLine:
        thrown > 0
          ? [TEXT.darts[language](thrown), ...(top.length > 0 ? [`${TEXT.mostHit[language]} ${top.join(' · ')}`] : [])].join(
              ' · ',
            )
          : null,
      segments: detail.segments,
      points: detail.points,
      trend: [],
      trendTitle: null,
    };
  }
  const before = previous?.modes.find(item => item.mode === stats.mode) ?? null;
  const figures = modeSpecs(stats)
    .map(spec => toFigure(spec, stats, before, language))
    .filter(figure => figure !== null)
    .slice(0, MODE_FIGURES);
  return {
    name,
    subtitle: `${modeName(stats.mode, stats.modeLabel, language)} · ${rangeLabel(range, language)}`,
    main: figures[0] ?? null,
    figures: figures.slice(1),
    hasChanges: figures.some(figure => figure.change !== null),
    hitLine: null,
    segments: [],
    points: [],
    trend: stats.trend.length >= 2 ? stats.trend : [],
    trendTitle: stats.trend.length >= 2 ? trendTitle(stats, language) : null,
  };
};

export interface VersusRow {
  label: string;
  left: number | null;
  right: number | null;
  leftText: string;
  rightText: string;
  leftAhead: boolean;
  rightAhead: boolean;
}

export interface VersusShare {
  subtitle: string;
  leftName: string;
  rightName: string;
  leftWins: number;
  rightWins: number;
  meta: string;
  // Oldest first.
  recent: Array<'left' | 'right' | 'other'>;
  streak: string | null;
  // Overview: each mode's matches and both players' wins.
  modes: Array<{ title: string; played: number; leftWins: number; rightWins: number }>;
  // One mode: its compared figures.
  rows: VersusRow[];
}

const RECENT_RESULTS = 10;

// The head-to-head card for the overview (mode null) or one mode.
export const summarizeVersus = (
  record: HeadToHead,
  mode: string | null,
  range: StatsRange,
  options: { language: ShareLanguage; showNames: boolean },
): VersusShare => {
  const { language, showNames } = options;
  const { left, right, results } = record;
  const leftName = playerLabel(left.name, 0, showNames, language);
  const rightName = playerLabel(right.name, 1, showNames, language);
  const othersWon = results.filter(result => result.winner === 'other').length;
  const latest = results[0]?.winner;
  const run = latest === 'left' || latest === 'right' ? results.findIndex(result => result.winner !== latest) : 0;
  const streakLength = run === -1 ? results.length : run;
  const leftStats = mode === null ? null : left.modes.find(item => item.mode === mode) ?? null;
  const rightStats = mode === null ? null : right.modes.find(item => item.mode === mode) ?? null;
  const modeTitle = leftStats ? modeName(leftStats.mode, leftStats.modeLabel, language) : null;
  return {
    subtitle: [TEXT.versus[language], ...(modeTitle ? [modeTitle] : []), rangeLabel(range, language)].join(' · '),
    leftName,
    rightName,
    leftWins: left.wins,
    rightWins: right.wins,
    meta: [TEXT.played[language](results.length), ...(othersWon > 0 ? [TEXT.othersWon[language](othersWon)] : [])].join(
      ' · ',
    ),
    recent: results
      .slice(0, RECENT_RESULTS)
      .reverse()
      .map(result => result.winner),
    streak:
      streakLength >= 2 ? TEXT.streak[language](latest === 'left' ? leftName : rightName, streakLength) : null,
    modes: leftStats
      ? []
      : left.modes.map(stats => ({
          title: modeName(stats.mode, stats.modeLabel, language),
          played: stats.matchesPlayed,
          leftWins: stats.wins,
          rightWins: right.modes.find(item => item.mode === stats.mode)?.wins ?? 0,
        })),
    rows:
      leftStats && rightStats
        ? compareRows(leftStats, rightStats).map(row => ({
            label: label(row.label, language),
            left: row.left,
            right: row.right,
            leftText: row.left === null ? '—' : row.format(row.left),
            rightText: row.right === null ? '—' : row.format(row.right),
            leftAhead: isAhead(row, row.left, row.right),
            rightAhead: isAhead(row, row.right, row.left),
          }))
        : [],
  };
};
