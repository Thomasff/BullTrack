import type { GameType, ThrowResult } from '../game/types';

export interface CompletedRoundRecord {
  // The person who threw these darts (in a team game, the team member).
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
    // Team game only (0 = A 队).
    teamIndex?: number | null;
    // The side's score on the final score board (a team member gets the team's).
    finalScore?: number | null;
  }>;
  // Every winning person: one player, or all members of the winning team.
  winnerIds: string[];
  rounds: CompletedRoundRecord[];
}

export interface MatchDetailPlayer {
  playerId: number;
  name: string;
  seatIndex: number;
  isWinner: boolean;
  teamIndex: number | null;
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

export interface PlayerModeMatch {
  matchId: number;
  createdAt: number;
  isWinner: boolean;
  // Final score of a solo match in a scoring mode; null otherwise.
  score: number | null;
  // Three-dart average in an X01 match; null otherwise.
  average: number | null;
}

export interface PlayerModeStats {
  mode: GameType | string;
  modeLabel: string | null;
  matchesPlayed: number;
  wins: number;
  // Highest final score in solo matches of a scoring mode (高分赛, Catch 40...); null otherwise.
  bestScore: number | null;
  // Average final score over the same solo matches; null otherwise.
  averageScore: number | null;
  // X01 modes only.
  x01: PlayerX01Stats | null;
  // Cricket modes with fixed targets only.
  mpr: number | null;
  // 99 Darts at 20 only: share of darts that landed in the 20.
  hitRate: number | null;
  // Around the clock only: darts used in solo wins.
  dartsToFinish: { best: number; average: number } | null;
  // Newest first.
  matches: PlayerModeMatch[];
}

export interface PlayerX01Stats {
  average: number;
  // Average of the first three rounds of each match.
  first9Average: number;
  // Rounds totalling 60-99, 100-139 and 140-179.
  count60: number;
  count100: number;
  count140: number;
  count180: number;
  // Highest winning round this player threw; null when they never checked out.
  bestCheckout: number | null;
  // Darts thrown at a one-dart finish (an even 2-40 or 50 left), and how many of them won.
  checkoutAttempts: number;
  checkoutHits: number;
}

// Darts that landed in one board segment; target is '1'-'20', 'OB', 'IB' or 'miss'.
export interface PlayerSegmentCount {
  target: string;
  multiplier: number;
  count: number;
}

export interface PlayerTrendPoint {
  matchId: number;
  createdAt: number;
  average: number;
}

export interface PlayerDetail {
  playerId: number;
  name: string;
  matchesPlayed: number;
  wins: number;
  x01: PlayerX01Stats | null;
  // Cricket marks per round over the cricket modes with fixed targets; null without such rounds.
  cricketMpr: number | null;
  modes: PlayerModeStats[];
  // Three-dart average of the latest X01 matches, oldest first.
  x01Trend: PlayerTrendPoint[];
  // Every dart this player threw in any mode, by segment.
  segments: PlayerSegmentCount[];
}
