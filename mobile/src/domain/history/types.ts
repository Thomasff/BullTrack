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

export interface MatchDetailPlayer {
  playerId: number;
  name: string;
  seatIndex: number;
  isWinner: boolean;
}

export interface MatchDetailRound {
  playerId: number;
  roundIndex: number;
  throws: Array<{
    dartIndex: number;
    score: number;
    multiplier: number;
    target: string;
  }>;
}

export interface MatchDetail {
  id: number;
  mode: GameType | string;
  modeLabel: string | null;
  createdAt: number;
  players: MatchDetailPlayer[];
  rounds: MatchDetailRound[];
}

export interface PlayerStats {
  playerId: number;
  name: string;
  matchesPlayed: number;
  wins: number;
  // Average 3-dart round total in X01 games; null when the player has no X01 rounds.
  x01Average: number | null;
  bestRound: number | null;
}

export interface RecentMatchSummary {
  id: number;
  mode: GameType | string;
  modeLabel: string | null;
  createdAt: number;
  playerCount: number;
  winnerName: string | null;
}
