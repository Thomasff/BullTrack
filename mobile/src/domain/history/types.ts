import type { GameType, ThrowResult } from '../game/types';
import type { BoardPoint } from '../game/boardGeometry';

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

// A day the mode was played, as local midnight, and the mode's main figure over that day.
export interface PlayerTrendPoint {
  day: number;
  value: number;
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
  // Darts this player threw in the solo matches they won.
  dartsPerLeg: { best: number; average: number } | null;
}

export interface PlayerCricketStats {
  // Marks per round on the mode's targets.
  mpr: number;
  // Marks per round over the first three rounds of each match.
  first9Mpr: number;
  // Rounds with five marks or more.
  count5Marks: number;
}

// Darts that landed in one board segment; target is '1'-'20', 'OB', 'IB' or 'miss'.
export interface PlayerSegmentCount {
  target: string;
  multiplier: number;
  count: number;
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
  // The groups below are filled only for the modes they belong to.
  x01: PlayerX01Stats | null;
  // Cricket modes with fixed targets.
  cricket: PlayerCricketStats | null;
  // 高分赛: three-dart round totals.
  rounds: { average: number; best: number } | null;
  // 99 Darts at 20: shares of all darts that hit the 20, a triple 20 and a double 20.
  darts99: { hitRate: number; tripleRate: number; doubleRate: number } | null;
  // Around the clock, solo matches: darts that hit the current target, and darts used in wins.
  aroundTheClock: {
    hitRate: number;
    dartsToFinish: { best: number; average: number } | null;
  } | null;
  // Shanghai, Half it and Bermuda: darts on the round's target, Shanghai rounds (single,
  // double and triple of the target), and rounds without a hit (halved) per match.
  targetRounds: { hitRate: number; shanghais: number; halvedPerMatch: number } | null;
  // Catch 40 and 41-60, solo matches: finishes made and played, average darts per finish.
  checkoutDrill: { finished: number; attempted: number; averageDarts: number | null } | null;
  // The mode's main figure per day played, oldest first: X01 average, cricket MPR,
  // final score, or Around the clock darts to finish.
  trend: PlayerTrendPoint[];
  segments: PlayerSegmentCount[];
  // Where this mode's detected darts landed; darts saved before landing points or placed
  // by hand have none.
  points: BoardPoint[];
  // Newest first.
  matches: PlayerModeMatch[];
}

export interface PlayerDetail {
  playerId: number;
  name: string;
  matchesPlayed: number;
  wins: number;
  // Most played first.
  modes: PlayerModeStats[];
  // Every dart this player threw in any mode, by segment.
  segments: PlayerSegmentCount[];
  points: BoardPoint[];
}
