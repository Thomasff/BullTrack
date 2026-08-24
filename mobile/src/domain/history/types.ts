import type { GameType, ThrowResult } from '../game/types';

export interface CompletedRoundRecord {
  playerId: string;
  roundIndex: number;
  throws: ThrowResult[];
}

export interface CompletedMatchInput {
  mode: GameType;
  modeLabel: string | null;
  createdAt: number;
  players: Array<{
    id: string;
    name: string;
  }>;
  winnerId: string | null;
  rounds: CompletedRoundRecord[];
}

export interface RecentMatchSummary {
  id: number;
  mode: GameType | string;
  modeLabel: string | null;
  createdAt: number;
  playerCount: number;
  winnerName: string | null;
}
