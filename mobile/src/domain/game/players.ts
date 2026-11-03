import { t } from '../../i18n';

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;

export const getDefaultPlayerName = (index: number) => t('common.defaultPlayer', { n: index + 1 });

// Default names saved in either language ("玩家 2", "Player 2").
const DEFAULT_NAME_PATTERN = /^(?:玩家|Player) (\d+)$/;

// Seats left unnamed are guests: their matches are saved, but they get no stats or history entry.
export const isDefaultPlayerName = (name: string) => DEFAULT_NAME_PATTERN.test(name.trim());

// Shows a saved default name in the current language; real names stay as they are.
export const displayPlayerName = (name: string) => {
  const match = DEFAULT_NAME_PATTERN.exec(name.trim());
  return match ? t('common.defaultPlayer', { n: Number(match[1]) }) : name;
};

// Fills empty names with defaults so every seat has a stable history identity.
export const resolvePlayerNames = (names: string[]) =>
  names.map((name, index) => name.trim() || getDefaultPlayerName(index));

// Players are stored by name, so one match cannot contain the same name twice.
export const findDuplicatePlayerName = (names: string[]) => {
  const seen = new Set<string>();
  for (const name of resolvePlayerNames(names)) {
    if (seen.has(name)) {
      return name;
    }
    seen.add(name);
  }
  return null;
};
