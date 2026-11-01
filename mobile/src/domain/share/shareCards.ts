import type { GameType, ThrowResult } from '../game/types';
import type { MatchDetail } from '../history/types';
import { isDefaultPlayerName } from '../game/players';
import type { Highlight } from './highlights';
import { markerPoint } from '../game/boardGeometry';

export type ShareLanguage = 'zh' | 'en';

export const SHARE_URL = 'github.com/Thomasff/BullTrack';

export interface RoundPhotos {
  // File URIs: the round board photo, and the close-up around the darts when there is one.
  full: string;
  close: string | null;
}

// Darts no further apart than this (board units: the double ring's outer edge is at 0.92, so
// about 11 cm) count as a group, which the automatic choice shows in close-up.
const CLOSE_GROUP_SPREAD = 0.6;

// The photo a round card shows for the chosen option; the round board stands in for a missing
// close-up.
export const pickRoundPhoto = (
  photos: RoundPhotos | null | undefined,
  choice: 'auto' | 'full' | 'close' | 'none',
  throws: ThrowResult[],
): { uri: string; kind: 'full' | 'close' } | null => {
  if (!photos || choice === 'none') {
    return null;
  }
  const close = photos.close;
  if (choice === 'close' && close) {
    return { uri: close, kind: 'close' };
  }
  if (choice === 'auto' && close) {
    const points = throws
      .map((item, index) => (item.ring === 'miss' ? null : markerPoint(item, index)))
      .filter(point => point !== null);
    const grouped =
      points.length > 0 &&
      points.every(a => points.every(b => Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_GROUP_SPREAD));
    if (grouped) {
      return { uri: close, kind: 'close' };
    }
  }
  return { uri: photos.full, kind: 'full' };
};

// What a round card shows: the darts on the virtual board and the round's main figure.
export interface RoundShare {
  mode: GameType;
  modeLabel: string | null;
  playerName: string;
  // Seat of the thrower, for "玩家 N" / "Player N" when names are hidden.
  playerSeat: number;
  roundNumber: number;
  throws: ThrowResult[];
  // Points, or marks in cricket modes.
  value: number;
  unit: 'points' | 'marks';
  // X01 only: what the round left, a bust, or the checkout.
  note: { kind: 'left'; value: number } | { kind: 'bust' } | { kind: 'checkout' } | null;
  // Set for a confirmed round that was a highlight; the card shows it as a red ribbon.
  highlight: Highlight | null;
  createdAt: number;
  // The live round's photos, made when its share opens; saved highlights find theirs by name.
  photos?: RoundPhotos | null;
}

const MODE_NAMES_EN: Record<GameType, string> = {
  highScore: 'High Score',
  darts99: '99 Darts at 20',
  aroundTheClock: 'Around the Clock',
  game301: '301',
  game501: '501',
  game701: '701',
  cricket: 'Cricket',
  cricketNoScore: 'No Score Cricket',
  tactics: 'Tactics',
  cutThroat: 'Cut Throat',
  shanghai: 'Shanghai',
  halfIt: 'Half It',
  bermuda: 'Bermuda',
  killer: 'Killer',
  gotcha301: 'Gotcha 301',
  randomCricket: 'Random Cricket',
  hammerCricket: 'Hammer Cricket',
  catch40: 'Catch 40',
  checkout4160: '41-60',
};

export const modeName = (mode: GameType | string, modeLabel: string | null, language: ShareLanguage) =>
  language === 'en'
    ? MODE_NAMES_EN[mode as GameType] ?? modeLabel ?? mode
    : modeLabel ?? MODE_NAMES_EN[mode as GameType] ?? mode;

// A hidden or unnamed ("玩家 2") player becomes "Player 2" on an English card.
export const playerLabel = (name: string, seat: number, showNames: boolean, language: ShareLanguage) => {
  if (showNames && !(language === 'en' && isDefaultPlayerName(name))) {
    return name;
  }
  return language === 'en' ? `Player ${seat + 1}` : `玩家 ${seat + 1}`;
};

const TEXT = {
  round: { zh: (n: number) => `第 ${n} 轮`, en: (n: number) => `Round ${n}` },
  points: { zh: '分', en: 'points' },
  marks: { zh: '标记', en: 'marks' },
  left: { zh: (n: number) => `剩 ${n}`, en: (n: number) => `${n} left` },
  bust: { zh: '爆镖', en: 'BUST' },
  checkout: { zh: '收镖', en: 'CHECKOUT' },
  wins: { zh: (name: string) => `${name} 获胜`, en: (name: string) => `${name} wins` },
  average: { zh: '三镖均分', en: '3-dart avg' },
  mpr: { zh: '每轮标记', en: 'MPR' },
  perRound: { zh: '每轮均分', en: 'Avg / round' },
  darts: { zh: '用镖', en: 'Darts' },
  best: { zh: '最佳一轮', en: 'Best round' },
  checkoutStat: { zh: '收镖', en: 'Checkout' },
  score: { zh: '得分', en: 'Score' },
  tagline: { zh: '安卓飞镖自动记分', en: 'Auto dart scoring on Android' },
};

export const shareText = {
  round: (n: number, language: ShareLanguage) => TEXT.round[language](n),
  unit: (unit: RoundShare['unit'], language: ShareLanguage) => TEXT[unit][language],
  note: (note: RoundShare['note'], language: ShareLanguage) => {
    if (!note) {
      return null;
    }
    return note.kind === 'left' ? TEXT.left[language](note.value) : TEXT[note.kind][language];
  },
  wins: (name: string, language: ShareLanguage) => TEXT.wins[language](name),
  tagline: (language: ShareLanguage) => TEXT.tagline[language],
};

// The caption sent along with the image, for apps that take one.
export const shareCaption = (language: ShareLanguage, showUrl: boolean) => {
  const base = language === 'en' ? 'Scored with BullTrack' : '用 BullTrack 自动记分';
  return showUrl ? `${base} · ${SHARE_URL}` : base;
};

export const formatShareDate = (createdAt: number) => {
  const date = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// BullTrack-<kind>-<date>.png; the gallery numbers repeats itself.
export const shareFileName = (kind: 'round' | 'match' | 'stats' | 'versus', createdAt: number) =>
  `BullTrack-${kind}-${formatShareDate(createdAt)}.png`;

export interface MatchShareStat {
  label: string;
  value: string;
}

export interface MatchShareSide {
  name: string;
  seat: number;
  teamIndex: number | null;
  isWinner: boolean;
  // The side's final score when the mode keeps one, else null.
  finalScore: number | null;
  stats: MatchShareStat[];
  // One point per round for the chart: score left in X01, the round total otherwise.
  trend: number[];
}

export interface MatchShare {
  title: string;
  mode: string;
  createdAt: number;
  rounds: number;
  // Score left before the first round in X01, for the chart's top; null otherwise.
  trendStart: number | null;
  sides: MatchShareSide[];
}

const X01_STARTING_SCORES: Record<string, number> = { game301: 301, game501: 501, game701: 701 };

// Cricket modes with fixed targets: lowest number counted (20 and the bull always count).
const MPR_TARGETS: Record<string, number> = { cricket: 15, cricketNoScore: 15, cutThroat: 15, tactics: 10 };

// Modes where the final score is the result (the higher, or in Cut Throat the lower, the better).
const SCORE_MODES = [
  'highScore',
  'darts99',
  'shanghai',
  'halfIt',
  'bermuda',
  'hammerCricket',
  'catch40',
  'checkout4160',
  'cricket',
  'tactics',
  'cutThroat',
  'randomCricket',
  'gotcha301',
];

type SavedDart = MatchDetail['rounds'][number]['throws'][number];

const dartMarks = (dart: SavedDart, lowest: number) => {
  if (dart.target === 'IB') {
    return 2;
  }
  if (dart.target === 'OB') {
    return 1;
  }
  const sector = Number(dart.target) || 0;
  return sector >= lowest && sector <= 20 ? dart.multiplier : 0;
};

const formatOne = (value: number) => value.toFixed(1);

// The match card's figures, per player, from the saved darts alone.
export const summarizeMatch = (
  detail: MatchDetail,
  options: { language: ShareLanguage; showNames: boolean },
): MatchShare => {
  const { language, showNames } = options;
  const isX01 = detail.mode in X01_STARTING_SCORES;
  const mprLowest = MPR_TARGETS[detail.mode];
  const start = X01_STARTING_SCORES[detail.mode] ?? 0;

  // X01: rounds count as thrown unless they bust; teammates share the score left.
  const sideOf = (playerId: number) => {
    const teamIndex = detail.players.find(player => player.playerId === playerId)?.teamIndex;
    return teamIndex === null || teamIndex === undefined ? `p${playerId}` : `t${teamIndex}`;
  };
  const left = new Map<string, number>();
  const effective = detail.rounds.map(round => {
    const total = round.throws.reduce((sum, dart) => sum + dart.score, 0);
    if (!isX01) {
      return total;
    }
    const side = sideOf(round.playerId);
    const before = left.get(side) ?? start;
    const after = before - total;
    const doubleOut = round.throws[round.throws.length - 1]?.multiplier === 2;
    const counts = after > 1 || (after === 0 && doubleOut);
    left.set(side, counts ? after : before);
    return counts ? total : 0;
  });
  // Score left after each round, per X01 side.
  const leftAfter = new Map<string, number>();
  const leftTrend = detail.rounds.map((round, index) => {
    const side = sideOf(round.playerId);
    const value = (leftAfter.get(side) ?? start) - effective[index];
    leftAfter.set(side, value);
    return value;
  });

  const sides = detail.players.map(player => {
    const indexes = detail.rounds
      .map((round, index) => (round.playerId === player.playerId ? index : -1))
      .filter(index => index >= 0);
    const darts = indexes.reduce((sum, index) => sum + detail.rounds[index].throws.length, 0);
    const totals = indexes.map(index => effective[index]);
    const best = totals.length > 0 ? Math.max(...totals) : 0;
    const stats: MatchShareStat[] = [];
    if (isX01) {
      const scored = totals.reduce((sum, value) => sum + value, 0);
      stats.push({ label: TEXT.average[language], value: formatOne(darts > 0 ? (scored / darts) * 3 : 0) });
      if (player.isWinner && indexes.length > 0) {
        stats.push({ label: TEXT.checkoutStat[language], value: String(totals[totals.length - 1]) });
      }
      stats.push({ label: TEXT.darts[language], value: String(darts) });
      stats.push({ label: TEXT.best[language], value: String(best) });
    } else if (mprLowest !== undefined) {
      const marks = indexes.map(index =>
        detail.rounds[index].throws.reduce((sum, dart) => sum + dartMarks(dart, mprLowest), 0),
      );
      const mpr = marks.reduce((sum, value) => sum + value, 0) / Math.max(1, marks.length);
      stats.push({ label: TEXT.mpr[language], value: formatOne(mpr) });
      stats.push({ label: TEXT.darts[language], value: String(darts) });
    } else {
      const perRound = totals.reduce((sum, value) => sum + value, 0) / Math.max(1, totals.length);
      stats.push({ label: TEXT.perRound[language], value: formatOne(perRound) });
      stats.push({ label: TEXT.darts[language], value: String(darts) });
      stats.push({ label: TEXT.best[language], value: String(best) });
    }
    return {
      name: playerLabel(player.name, player.seatIndex, showNames, language),
      seat: player.seatIndex,
      teamIndex: player.teamIndex,
      isWinner: player.isWinner,
      finalScore: SCORE_MODES.includes(detail.mode) ? player.finalScore : null,
      stats,
      trend: indexes.map(index => (isX01 ? leftTrend[index] : effective[index])),
    };
  });

  return {
    title: modeName(detail.mode, detail.modeLabel, language),
    mode: detail.mode,
    createdAt: detail.createdAt,
    rounds: Math.max(0, ...detail.rounds.map(round => round.roundIndex)),
    trendStart: isX01 ? start : null,
    sides,
  };
};

// "Tom wins", or the winning team's members; null when nobody won.
export const winnerLine = (share: MatchShare, language: ShareLanguage) => {
  const winners = share.sides.filter(side => side.isWinner);
  if (winners.length === 0) {
    return null;
  }
  const names = winners.map(side => side.name).join(language === 'en' ? ' & ' : '、');
  return TEXT.wins[language](names);
};

export const scoreLabel = (language: ShareLanguage) => TEXT.score[language];
