import type { ModeCategoryId, ModeOptionId } from '../../domain/game/modeCatalog';
import type { RoundShare } from '../../domain/share/shareCards';

export type RootStackParamList = {
  Home: undefined;
  ModeSelect: { categoryId: ModeCategoryId };
  PlayerSetup: { modeOptionId: ModeOptionId };
  Game: undefined;
  Debug: undefined;
  MatchDetail: { matchId: number };
  PlayerDetail: { playerId: number };
  HeadToHead: { playerId: number; opponentId: number };
  MatchList: undefined;
  // A round card, a match card (by history id), or both as tabs.
  // highlight opens the match's highlights on that round (key from roundKey).
  SharePreview: { round?: RoundShare; matchId?: number; highlight?: string };
};
