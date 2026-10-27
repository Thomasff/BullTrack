import type { GameType } from './types';

export type ModeCategoryId = 'x01' | 'cricket' | 'practice' | 'party';

export type ModeOptionId =
  | 'x01-301'
  | 'x01-501'
  | 'x01-701'
  | 'cricket-standard'
  | 'cricket-no-score'
  | 'cricket-tactics'
  | 'cricket-random'
  | 'cricket-cut-throat'
  | 'practice-around-the-clock'
  | 'practice-high-score'
  | 'practice-41-60'
  | 'practice-catch-40'
  | 'practice-99-darts'
  | 'party-hammer-cricket'
  | 'party-half-it'
  | 'party-killer'
  | 'party-shanghai'
  | 'party-bermuda'
  | 'party-gotcha-301';

export interface ModeCategoryDefinition {
  id: ModeCategoryId;
  title: string;
  description: string;
}

export interface ModeOptionDefinition {
  id: ModeOptionId;
  categoryId: ModeCategoryId;
  title: string;
  description: string;
  // Options without real rules yet; kept in the catalog but hidden from the UI.
  runtimeGameType: GameType | null;
  // Fewest players (or teams) the game needs; 1 when omitted.
  minSides?: number;
}

const allModeCategories: ModeCategoryDefinition[] = [
  {
    id: 'x01',
    title: 'X01',
    description: '301 / 501 / 701 减分赛，双倍区收镖。',
  },
  {
    id: 'cricket',
    title: 'CRICKET',
    description: '抢占 15-20 与靶心。',
  },
  {
    id: 'practice',
    title: '练习赛',
    description: '顺序命中、高分与定点训练。',
  },
  {
    id: 'party',
    title: '娱乐赛',
    description: '聚会和变体玩法。',
  },
];

const allModeOptions: ModeOptionDefinition[] = [
  {
    id: 'x01-301',
    categoryId: 'x01',
    title: '301',
    description: '从 301 开始，双倍区收镖。',
    runtimeGameType: 'game301',
  },
  {
    id: 'x01-501',
    categoryId: 'x01',
    title: '501',
    description: '从 501 开始，双倍区收镖。',
    runtimeGameType: 'game501',
  },
  {
    id: 'x01-701',
    categoryId: 'x01',
    title: '701',
    description: '从 701 开始，双倍区收镖。',
    runtimeGameType: 'game701',
  },
  {
    id: 'cricket-standard',
    categoryId: 'cricket',
    title: 'Standard Cricket',
    description: '抢先关闭 15-20 和靶心，关闭后还能继续得分。',
    runtimeGameType: 'cricket',
  },
  {
    id: 'cricket-no-score',
    categoryId: 'cricket',
    title: 'No Score Cricket',
    description: '不计分，先把 15-20 和靶心全部关闭者胜。',
    runtimeGameType: 'cricketNoScore',
  },
  {
    id: 'cricket-tactics',
    categoryId: 'cricket',
    title: 'Tactics',
    description: '目标扩大到 10-20 和靶心，其余同标准 Cricket。',
    runtimeGameType: 'tactics',
  },
  {
    id: 'cricket-random',
    categoryId: 'cricket',
    title: 'Random Cricket',
    description: '目标换成随机抽的 6 个数加靶心。',
    runtimeGameType: 'randomCricket',
  },
  {
    id: 'cricket-cut-throat',
    categoryId: 'cricket',
    title: 'Cut Throat',
    description: '得分加给对手，分最低者胜。',
    runtimeGameType: 'cutThroat',
  },
  {
    id: 'practice-around-the-clock',
    categoryId: 'practice',
    title: 'Around the clock',
    description: '按 1 到 20 再到靶心的顺序依次命中，先完成者胜。',
    runtimeGameType: 'aroundTheClock',
  },
  {
    id: 'practice-high-score',
    categoryId: 'practice',
    title: '高分赛',
    description: '每人 10 轮，总分最高者胜。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'practice-99-darts',
    categoryId: 'practice',
    title: '99 Darts at 20',
    description: '每人 33 轮共 99 镖，只计 20 区得分。',
    runtimeGameType: 'darts99',
  },
  {
    id: 'practice-41-60',
    categoryId: 'practice',
    title: '41-60',
    description: '依次练 41 到 60 的收镖，每个数一轮。',
    runtimeGameType: 'checkout4160',
  },
  {
    id: 'practice-catch-40',
    categoryId: 'practice',
    title: 'Catch 40',
    description: '依次练 61 到 100 的收镖，每个数最多 6 镖。',
    runtimeGameType: 'catch40',
  },
  {
    id: 'party-hammer-cricket',
    categoryId: 'party',
    title: 'Hammer cricket',
    description: '8 轮累计得分，越靠后的镖倍数越高，全空扣分。',
    runtimeGameType: 'hammerCricket',
  },
  {
    id: 'party-half-it',
    categoryId: 'party',
    title: 'Half it',
    description: '每轮一个目标，三镖全空总分减半。',
    runtimeGameType: 'halfIt',
  },
  {
    id: 'party-killer',
    categoryId: 'party',
    title: 'Killer',
    description: '先成为杀手，再打掉对手的命。',
    runtimeGameType: 'killer',
    minSides: 2,
  },
  {
    id: 'party-shanghai',
    categoryId: 'party',
    title: 'Shanghai',
    description: '第 N 轮只打 N 区，单双三倍齐中直接获胜。',
    runtimeGameType: 'shanghai',
  },
  {
    id: 'party-bermuda',
    categoryId: 'party',
    title: 'Bermuda',
    description: '13 轮各有目标，三镖全空总分减半。',
    runtimeGameType: 'bermuda',
  },
  {
    id: 'party-gotcha-301',
    categoryId: 'party',
    title: 'Gotcha 301',
    description: '加到正好 301 获胜，追平对手可让其归零。',
    runtimeGameType: 'gotcha301',
  },
];

export type PlayableModeOption = ModeOptionDefinition & { runtimeGameType: GameType };

const isPlayable = (option: ModeOptionDefinition): option is PlayableModeOption =>
  option.runtimeGameType !== null;

export const modeOptions = allModeOptions.filter(isPlayable);

export const modeCategories = allModeCategories.filter(category =>
  modeOptions.some(option => option.categoryId === category.id),
);

export const getModeCategory = (categoryId: ModeCategoryId) =>
  modeCategories.find(category => category.id === categoryId) ?? null;

export const getModeOptionsByCategory = (categoryId: ModeCategoryId) =>
  modeOptions.filter(option => option.categoryId === categoryId);

export const getModeOption = (optionId: ModeOptionId) =>
  modeOptions.find(option => option.id === optionId) ?? null;
