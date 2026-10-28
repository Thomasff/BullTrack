import type { ModeCategoryId, ModeOptionId } from '../../domain/game/modeCatalog';

export type RootStackParamList = {
  Home: undefined;
  ModeSelect: { categoryId: ModeCategoryId };
  PlayerSetup: { modeOptionId: ModeOptionId };
  Game: undefined;
  Debug: undefined;
  MatchDetail: { matchId: number };
  PlayerDetail: { playerId: number };
};
