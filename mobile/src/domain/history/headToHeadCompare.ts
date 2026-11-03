import type { PlayerModeStats } from './types';
import { t } from '../../i18n';
import type { stats as statsText } from '../../i18n/locales/zh/stats';

// What the head-to-head page and card compare two players on, per mode.

type Figure = keyof typeof statsText.figures;

// One compared figure; null when that player has none.
export interface CompareRowData {
  figure: Figure;
  // Always the Chinese label: the share cards translate it into the card's own language.
  label: string;
  left: number | null;
  right: number | null;
  format: (value: number) => string;
  lowerIsBetter?: boolean;
}

const formatPercent = (share: number) => `${Math.round(share * 100)}%`;
const formatOne = (value: number) => value.toFixed(1);
const formatTwo = (value: number) => value.toFixed(2);
const formatWhole = (value: number) => `${Math.round(value)}`;

// The figures both sides of a mode are compared on, wins first.
export const compareRows = (left: PlayerModeStats, right: PlayerModeStats) => {
  const rows: CompareRowData[] = [];
  const add = (
    figure: Figure,
    get: (stats: PlayerModeStats) => number | null | undefined,
    format: (value: number) => string,
    lowerIsBetter = false,
  ) => {
    const leftValue = get(left) ?? null;
    const rightValue = get(right) ?? null;
    if (leftValue !== null || rightValue !== null) {
      rows.push({
        figure,
        label: t(`stats.figures.${figure}`, { lng: 'zh' }),
        left: leftValue,
        right: rightValue,
        format,
        lowerIsBetter,
      });
    }
  };
  const share = (hits: number, attempts: number) =>
    attempts > 0 ? hits / attempts : null;

  add('wins', stats => stats.wins, formatWhole);
  add('average', stats => stats.x01?.average, formatOne);
  add('first9Average', stats => stats.x01?.first9Average, formatOne);
  add(
    'checkoutRate',
    stats =>
      stats.x01 && share(stats.x01.checkoutHits, stats.x01.checkoutAttempts),
    formatPercent,
  );
  add('bestCheckout', stats => stats.x01?.bestCheckout, formatWhole);
  add('count180', stats => stats.x01?.count180, formatWhole);
  add(
    'dartsPerWin',
    stats => stats.x01?.dartsPerLeg?.average,
    formatOne,
    true,
  );
  add('mpr', stats => stats.cricket?.mpr, formatTwo);
  add('first9Mpr', stats => stats.cricket?.first9Mpr, formatTwo);
  add('bestScore', stats => stats.bestScore, formatWhole);
  add('averageScore', stats => stats.averageScore, formatOne);
  add('roundAverage', stats => stats.rounds?.average, formatOne);
  add('bestRound', stats => stats.rounds?.best, formatWhole);
  add('hit20', stats => stats.darts99?.hitRate, formatPercent);
  add('treble20', stats => stats.darts99?.tripleRate, formatPercent);
  add('targetHit', stats => stats.aroundTheClock?.hitRate, formatPercent);
  add(
    'averageDarts',
    stats => stats.aroundTheClock?.dartsToFinish?.average,
    formatOne,
    true,
  );
  add('roundTargetHit', stats => stats.targetRounds?.hitRate, formatPercent);
  if (left.mode === 'shanghai') {
    add('shanghais', stats => stats.targetRounds?.shanghais, formatWhole);
  } else {
    add(
      'halvedPerMatch',
      stats => stats.targetRounds?.halvedPerMatch,
      formatOne,
      true,
    );
  }
  add(
    'finishes',
    stats =>
      stats.checkoutDrill &&
      share(stats.checkoutDrill.finished, stats.checkoutDrill.attempted),
    formatPercent,
  );
  add(
    'dartsPerFinish',
    stats => stats.checkoutDrill?.averageDarts,
    formatOne,
    true,
  );
  return rows;
};

// Whether this side is better or level; a side without a value never is.
export const isAhead = (
  row: CompareRowData,
  mine: number | null,
  theirs: number | null,
) => {
  if (mine === null) {
    return false;
  }
  if (theirs === null) {
    return true;
  }
  return row.lowerIsBetter ? mine <= theirs : mine >= theirs;
};
