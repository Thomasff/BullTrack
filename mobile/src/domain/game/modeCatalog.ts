import type { GameType } from './types';
import { t } from '../../i18n';

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

// Titles and descriptions are translated when asked for, so they follow a language switch.
export interface ModeCategoryDefinition {
  id: ModeCategoryId;
}

export interface ModeOptionDefinition {
  id: ModeOptionId;
  categoryId: ModeCategoryId;
  // Options without real rules yet; kept in the catalog but hidden from the UI.
  runtimeGameType: GameType | null;
  // Fewest players (or teams) the game needs; 1 when omitted.
  minSides?: number;
}

const allModeCategories: ModeCategoryDefinition[] = [
  { id: 'x01' },
  { id: 'cricket' },
  { id: 'practice' },
  { id: 'party' },
];

const allModeOptions: ModeOptionDefinition[] = [
  {
    id: 'x01-301',
    categoryId: 'x01',
    runtimeGameType: 'game301',
  },
  {
    id: 'x01-501',
    categoryId: 'x01',
    runtimeGameType: 'game501',
  },
  {
    id: 'x01-701',
    categoryId: 'x01',
    runtimeGameType: 'game701',
  },
  {
    id: 'cricket-standard',
    categoryId: 'cricket',
    runtimeGameType: 'cricket',
  },
  {
    id: 'cricket-no-score',
    categoryId: 'cricket',
    runtimeGameType: 'cricketNoScore',
  },
  {
    id: 'cricket-tactics',
    categoryId: 'cricket',
    runtimeGameType: 'tactics',
  },
  {
    id: 'cricket-random',
    categoryId: 'cricket',
    runtimeGameType: 'randomCricket',
  },
  {
    id: 'cricket-cut-throat',
    categoryId: 'cricket',
    runtimeGameType: 'cutThroat',
  },
  {
    id: 'practice-around-the-clock',
    categoryId: 'practice',
    runtimeGameType: 'aroundTheClock',
  },
  {
    id: 'practice-high-score',
    categoryId: 'practice',
    runtimeGameType: 'highScore',
  },
  {
    id: 'practice-99-darts',
    categoryId: 'practice',
    runtimeGameType: 'darts99',
  },
  {
    id: 'practice-41-60',
    categoryId: 'practice',
    runtimeGameType: 'checkout4160',
  },
  {
    id: 'practice-catch-40',
    categoryId: 'practice',
    runtimeGameType: 'catch40',
  },
  {
    id: 'party-hammer-cricket',
    categoryId: 'party',
    runtimeGameType: 'hammerCricket',
  },
  {
    id: 'party-half-it',
    categoryId: 'party',
    runtimeGameType: 'halfIt',
  },
  {
    id: 'party-killer',
    categoryId: 'party',
    runtimeGameType: 'killer',
    minSides: 2,
  },
  {
    id: 'party-shanghai',
    categoryId: 'party',
    runtimeGameType: 'shanghai',
  },
  {
    id: 'party-bermuda',
    categoryId: 'party',
    runtimeGameType: 'bermuda',
  },
  {
    id: 'party-gotcha-301',
    categoryId: 'party',
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

export const getModeCategoryTitle = (categoryId: ModeCategoryId) =>
  t(`modes.categories.${categoryId}.title`);

export const getModeCategoryDescription = (categoryId: ModeCategoryId) =>
  t(`modes.categories.${categoryId}.description`);

// An option's title is its game's name, the one history shows too.
export const getModeOptionTitle = (option: PlayableModeOption) =>
  t(`modes.names.${option.runtimeGameType}`);

export const getModeOptionDescription = (option: ModeOptionDefinition) =>
  t(`modes.descriptions.${option.id}`);
