import type { ModeCategoryId, ModeOptionId } from '../../domain/game/modeCatalog';
import type { RoundShare } from '../../domain/share/shareCards';
import type { StatsRange } from '../../domain/share/statsCards';

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
  // player and versus are the stats cards, for the overview (mode null) or one mode.
  SharePreview: {
    round?: RoundShare;
    matchId?: number;
    highlight?: string;
    player?: { playerId: number; range: StatsRange; mode: string | null };
    versus?: { playerId: number; opponentId: number; range: StatsRange; mode: string | null };
  };
};
