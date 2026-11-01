import { summarizePlayerStats, summarizeVersus } from '../src/domain/share/statsCards';
import type { HeadToHead, PlayerDetail, PlayerModeStats } from '../src/domain/history/types';

const modeStats = (overrides: Partial<PlayerModeStats>): PlayerModeStats => ({
  mode: 'game501',
  modeLabel: '501',
  matchesPlayed: 4,
  wins: 2,
  bestScore: null,
  averageScore: null,
  x01: null,
  cricket: null,
  rounds: null,
  darts99: null,
  aroundTheClock: null,
  targetRounds: null,
  checkoutDrill: null,
  trend: [],
  segments: [],
  points: [],
  matches: [],
  ...overrides,
});

const x01 = (average: number, checkoutHits: number) =>
  modeStats({
    x01: {
      average,
      first9Average: average + 5,
      count60: 0,
      count100: 0,
      count140: 0,
      count180: 1,
      bestCheckout: null,
      checkoutAttempts: 10,
      checkoutHits,
      dartsPerLeg: null,
    },
    trend: [
      { day: 1, value: 40 },
      { day: 2, value: average },
    ],
  });

const player = (wins: number, misses: number, modes: PlayerModeStats[]): PlayerDetail => ({
  playerId: 1,
  name: 'Tom',
  matchesPlayed: 10,
  wins,
  modes,
  segments: [
    { target: '20', multiplier: 3, count: 30 },
    { target: '1', multiplier: 1, count: 50 },
    { target: 'miss', multiplier: 0, count: misses },
  ],
  points: [],
  opponents: [],
});

const options = { language: 'zh' as const, showNames: true };

test('overview card: figures, top segments and changes against the 30 days before', () => {
  const card = summarizePlayerStats(player(6, 20, []), player(5, 30, []), null, 'recent', options);
  expect(card.subtitle).toBe('统计 · 近 30 天');
  expect(card.main).toBeNull();
  expect(card.figures).toEqual([
    { label: '场次', value: '10', change: null },
    { label: '胜率', value: '60%', change: { text: '↑10', better: true } },
    // 20 of 100 darts against 30 of 110: fewer misses is better.
    { label: '脱靶率', value: '20%', change: { text: '↓7', better: true } },
  ]);
  expect(card.hasChanges).toBe(true);
  expect(card.hitLine).toBe('共 100 镖 · 最常命中 1 · T20');

  const all = summarizePlayerStats(player(6, 20, []), null, null, 'all', { language: 'en', showNames: false });
  expect(all.name).toBe('Player');
  expect(all.hasChanges).toBe(false);
  expect(all.hitLine).toBe('100 darts · Most hit 1 · T20');
});

test('mode card: main figure, grid and trend', () => {
  const card = summarizePlayerStats(player(6, 0, [x01(52.44, 4)]), player(5, 0, [x01(48, 4)]), 'game501', 'recent', options);
  expect(card.subtitle).toBe('501 · 近 30 天');
  expect(card.main).toEqual({ label: '三镖均分', value: '52.4', change: { text: '↑4.4', better: true } });
  expect(card.figures.map(figure => figure.label)).toEqual(['前 9 镖均分', '收镖成功率', '180 次数']);
  // The same checkout rate shows no arrow.
  expect(card.figures[1].change).toBeNull();
  expect(card.trend).toHaveLength(2);
  expect(card.trendTitle).toBe('均分走势（按天）');

  const killer = summarizePlayerStats(
    player(6, 0, [modeStats({ mode: 'killer', modeLabel: 'Killer' })]),
    null,
    'killer',
    'all',
    options,
  );
  expect(killer.main).toEqual({ label: '胜率', value: '50%', change: null });
  expect(killer.trend).toEqual([]);
});

test('versus card: score, recent results, streak and compared figures', () => {
  const left = player(2, 0, [x01(50, 4)]);
  const right = { ...player(1, 0, [{ ...x01(55, 2), wins: 1 }]), playerId: 2, name: 'Amy' };
  const record: HeadToHead = {
    left,
    right,
    results: [
      { matchId: 4, createdAt: 4, winner: 'left' },
      { matchId: 3, createdAt: 3, winner: 'left' },
      { matchId: 2, createdAt: 2, winner: 'other' },
      { matchId: 1, createdAt: 1, winner: 'right' },
    ],
  };
  const overview = summarizeVersus(record, null, 'all', options);
  expect(overview.subtitle).toBe('对战 · 全部');
  expect(overview.meta).toBe('共 4 场 · 1 场别人赢');
  expect(overview.recent).toEqual(['right', 'other', 'left', 'left']);
  expect(overview.streak).toBe('Tom 当前 2 连胜');
  expect(overview.modes).toEqual([{ title: '501', played: 4, leftWins: 2, rightWins: 1 }]);

  const mode = summarizeVersus(record, 'game501', 'all', { language: 'en', showNames: true });
  expect(mode.subtitle).toBe('Head to head · 501 · All time');
  expect(mode.rows[0]).toMatchObject({ label: 'Wins', leftText: '2', rightText: '1', leftAhead: true, rightAhead: false });
  expect(mode.rows[1]).toMatchObject({ label: '3-dart avg', leftAhead: false, rightAhead: true });
});
