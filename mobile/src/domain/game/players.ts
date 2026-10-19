export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;

export const getDefaultPlayerName = (index: number) => `玩家 ${index + 1}`;

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
