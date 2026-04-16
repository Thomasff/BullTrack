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
  runtimeGameType: GameType;
}

export const modeCategories: ModeCategoryDefinition[] = [
  {
    id: 'x01',
    title: 'X01',
    description: '进入 301、501、701 等标准减分赛入口。',
  },
  {
    id: 'cricket',
    title: 'CRICKET',
    description: '进入标准 Cricket 及其变体入口。',
  },
  {
    id: 'practice',
    title: '练习赛',
    description: '进入训练与专项命中练习入口。',
  },
  {
    id: 'party',
    title: '娱乐赛',
    description: '进入聚会和变体玩法入口。',
  },
];

export const modeOptions: ModeOptionDefinition[] = [
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
    description: '进入 701 入口，当前先沿用现有 X01 流程。',
    runtimeGameType: 'game501',
  },
  {
    id: 'cricket-standard',
    categoryId: 'cricket',
    title: 'Standard Cricket',
    description: '标准 Cricket 模式入口。',
    runtimeGameType: 'cricket',
  },
  {
    id: 'cricket-no-score',
    categoryId: 'cricket',
    title: 'No Score Cricket',
    description: '不累计得分的 Cricket 入口。',
    runtimeGameType: 'cricket',
  },
  {
    id: 'cricket-tactics',
    categoryId: 'cricket',
    title: 'Tactics',
    description: '战术型 Cricket 入口。',
    runtimeGameType: 'cricket',
  },
  {
    id: 'cricket-random',
    categoryId: 'cricket',
    title: 'Random Cricket',
    description: '随机目标 Cricket 入口。',
    runtimeGameType: 'cricket',
  },
  {
    id: 'cricket-cut-throat',
    categoryId: 'cricket',
    title: 'Cut Throat',
    description: 'Cut Throat Cricket 入口。',
    runtimeGameType: 'cricket',
  },
  {
    id: 'practice-around-the-clock',
    categoryId: 'practice',
    title: 'Around the clock',
    description: '顺序命中训练入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'practice-41-60',
    categoryId: 'practice',
    title: '41-60',
    description: '高分区间训练入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'practice-catch-40',
    categoryId: 'practice',
    title: 'Catch 40',
    description: '收镖专项训练入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'practice-99-darts',
    categoryId: 'practice',
    title: '99 Darts at xx',
    description: '固定目标投掷训练入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'party-hammer-cricket',
    categoryId: 'party',
    title: 'Hammer cricket',
    description: 'Hammer cricket 入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'party-half-it',
    categoryId: 'party',
    title: 'Half it',
    description: 'Half it 入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'party-killer',
    categoryId: 'party',
    title: 'Killer',
    description: 'Killer 入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'party-shanghai',
    categoryId: 'party',
    title: 'Shanghai',
    description: 'Shanghai 入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'party-bermuda',
    categoryId: 'party',
    title: 'Bermuda',
    description: 'Bermuda 入口。',
    runtimeGameType: 'highScore',
  },
  {
    id: 'party-gotcha-301',
    categoryId: 'party',
    title: 'Gotcha 301',
    description: 'Gotcha 301 入口。',
    runtimeGameType: 'highScore',
  },
];

export const getModeCategory = (categoryId: ModeCategoryId) =>
  modeCategories.find(category => category.id === categoryId) ?? null;

export const getModeOptionsByCategory = (categoryId: ModeCategoryId) =>
  modeOptions.filter(option => option.categoryId === categoryId);

export const getModeOption = (optionId: ModeOptionId) =>
  modeOptions.find(option => option.id === optionId) ?? null;
