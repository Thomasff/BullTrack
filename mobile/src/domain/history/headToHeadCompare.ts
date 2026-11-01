import type { PlayerModeStats } from './types';

// What the head-to-head page and card compare two players on, per mode.

// One compared figure; null when that player has none.
export interface CompareRowData {
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
    label: string,
    get: (stats: PlayerModeStats) => number | null | undefined,
    format: (value: number) => string,
    lowerIsBetter = false,
  ) => {
    const leftValue = get(left) ?? null;
    const rightValue = get(right) ?? null;
    if (leftValue !== null || rightValue !== null) {
      rows.push({
        label,
        left: leftValue,
        right: rightValue,
        format,
        lowerIsBetter,
      });
    }
  };
  const share = (hits: number, attempts: number) =>
    attempts > 0 ? hits / attempts : null;

  add('胜场', stats => stats.wins, formatWhole);
  add('三镖均分', stats => stats.x01?.average, formatOne);
  add('前 9 镖均分', stats => stats.x01?.first9Average, formatOne);
  add(
    '收镖成功率',
    stats =>
      stats.x01 && share(stats.x01.checkoutHits, stats.x01.checkoutAttempts),
    formatPercent,
  );
  add('最高收镖', stats => stats.x01?.bestCheckout, formatWhole);
  add('180 次数', stats => stats.x01?.count180, formatWhole);
  add(
    '胜局平均用镖',
    stats => stats.x01?.dartsPerLeg?.average,
    formatOne,
    true,
  );
  add('MPR（每轮记次）', stats => stats.cricket?.mpr, formatTwo);
  add('前 9 镖 MPR', stats => stats.cricket?.first9Mpr, formatTwo);
  add('最好成绩', stats => stats.bestScore, formatWhole);
  add('平均成绩', stats => stats.averageScore, formatOne);
  add('每轮平均分', stats => stats.rounds?.average, formatOne);
  add('最高单轮', stats => stats.rounds?.best, formatWhole);
  add('命中 20 区', stats => stats.darts99?.hitRate, formatPercent);
  add('三倍 20', stats => stats.darts99?.tripleRate, formatPercent);
  add('命中当前目标', stats => stats.aroundTheClock?.hitRate, formatPercent);
  add(
    '平均用镖',
    stats => stats.aroundTheClock?.dartsToFinish?.average,
    formatOne,
    true,
  );
  add('命中本轮目标', stats => stats.targetRounds?.hitRate, formatPercent);
  if (left.mode === 'shanghai') {
    add('Shanghai 次数', stats => stats.targetRounds?.shanghais, formatWhole);
  } else {
    add(
      '每局被减半次数',
      stats => stats.targetRounds?.halvedPerMatch,
      formatOne,
      true,
    );
  }
  add(
    '收掉的数',
    stats =>
      stats.checkoutDrill &&
      share(stats.checkoutDrill.finished, stats.checkoutDrill.attempted),
    formatPercent,
  );
  add(
    '收掉时平均用镖',
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
