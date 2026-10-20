import type {
  GameType,
  PlayerSummary,
  RoundResult,
  ScoreBoard,
  ThrowResult,
} from '../../domain/game/types';
import { BOARD_SECTORS, getThrowSector } from '../../domain/game/throws';

interface GameEngine {
  readonly type: GameType;
  getCurrentPlayerId(): string;
  getScoreBoard(): ScoreBoard;
  applyRound(throws: ThrowResult[]): RoundResult;
  isGameOver(): boolean;
  getWinnerId(): string | null;
  getCurrentRoundNumber(): number;
  reset(): void;
}

const clonePlayers = (players: PlayerSummary[]): PlayerSummary[] =>
  players.map(player => ({
    ...player,
    roundScores: [...player.roundScores],
    marks: player.marks ? { ...player.marks } : undefined,
  }));

export const HIGH_SCORE_ROUNDS = 10;
export const DARTS_99_ROUNDS = 33;
export const DARTS_99_TARGET = 20;

// Fixed-round game where the highest total wins; darts99 only counts hits on its target.
class HighScoreEngine implements GameEngine {
  readonly type: 'highScore' | 'darts99';
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private completedRounds = 0;
  private readonly totalRounds: number;

  constructor(type: 'highScore' | 'darts99', players: PlayerSummary[]) {
    this.type = type;
    this.totalRounds = type === 'darts99' ? DARTS_99_ROUNDS : HIGH_SCORE_ROUNDS;
    this.players = clonePlayers(players);
  }

  private scoreThrow(throwResult: ThrowResult) {
    if (this.type === 'darts99' && getThrowSector(throwResult) !== DARTS_99_TARGET) {
      return 0;
    }
    return throwResult.score;
  }

  getCurrentPlayerId() {
    return this.players[this.currentPlayerIndex].id;
  }

  getScoreBoard() {
    return { players: clonePlayers(this.players) };
  }

  applyRound(throws: ThrowResult[]): RoundResult {
    const player = this.players[this.currentPlayerIndex];
    const roundScore = throws.reduce((sum, item) => sum + this.scoreThrow(item), 0);
    player.score += roundScore;
    player.roundScores = [...player.roundScores, roundScore];

    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    if (this.currentPlayerIndex === 0) {
      this.completedRounds += 1;
    }

    return {
      playerId: player.id,
      playerName: player.name,
      throws,
      roundScore,
    };
  }

  isGameOver() {
    return this.completedRounds >= this.totalRounds && this.currentPlayerIndex === 0;
  }

  getWinnerId() {
    if (!this.isGameOver()) {
      return null;
    }
    return [...this.players].sort((left, right) => right.score - left.score)[0]?.id ?? null;
  }

  getCurrentRoundNumber() {
    return this.completedRounds + 1;
  }

  reset() {
    this.currentPlayerIndex = 0;
    this.completedRounds = 0;
    this.players.forEach(player => {
      player.score = 0;
      player.roundScores = [];
    });
  }
}

const x01StartingScores = {
  game301: 301,
  game501: 501,
  game701: 701,
};

class X01Engine implements GameEngine {
  readonly type: GameType;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private winnerId: string | null = null;
  private readonly startingScore: number;

  constructor(type: keyof typeof x01StartingScores, players: PlayerSummary[]) {
    this.type = type;
    this.startingScore = x01StartingScores[type];
    this.players = clonePlayers(players).map(player => ({
      ...player,
      score: this.startingScore,
    }));
  }

  getCurrentPlayerId() {
    return this.players[this.currentPlayerIndex].id;
  }

  getScoreBoard() {
    return { players: clonePlayers(this.players) };
  }

  applyRound(throws: ThrowResult[]): RoundResult {
    const player = this.players[this.currentPlayerIndex];
    const roundScore = throws.reduce((sum, item) => sum + item.score, 0);
    const nextScore = player.score - roundScore;

    if (nextScore === 0) {
      const lastThrow = throws[throws.length - 1];
      const hasDoubleOut =
        lastThrow?.ring === 'double' || lastThrow?.ring === 'innerBull';
      if (hasDoubleOut) {
        player.score = 0;
        player.roundScores = [...player.roundScores, roundScore];
        this.winnerId = player.id;
      } else {
        player.roundScores = [...player.roundScores, 0];
      }
    } else if (nextScore < 0 || nextScore === 1) {
      player.roundScores = [...player.roundScores, 0];
    } else {
      player.score = nextScore;
      player.roundScores = [...player.roundScores, roundScore];
    }

    if (this.winnerId === null) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    }

    return {
      playerId: player.id,
      playerName: player.name,
      throws,
      roundScore: player.roundScores[player.roundScores.length - 1] ?? 0,
    };
  }

  isGameOver() {
    return this.winnerId !== null;
  }

  getWinnerId() {
    return this.winnerId;
  }

  getCurrentRoundNumber() {
    // Counted per player: once seat 1 has thrown, seat 2 is still in the same round.
    // The winner stays current, so after a win this is the winning round.
    const roundsPlayed = this.players[this.currentPlayerIndex].roundScores.length;
    return roundsPlayed + (this.winnerId ? 0 : 1);
  }

  reset() {
    this.currentPlayerIndex = 0;
    this.winnerId = null;
    this.players.forEach(player => {
      player.score = this.startingScore;
      player.roundScores = [];
    });
  }
}

class CricketEngine implements GameEngine {
  readonly type = 'cricket' as const;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private winnerId: string | null = null;
  private readonly targets = ['15', '16', '17', '18', '19', '20', '25'];

  constructor(players: PlayerSummary[]) {
    this.players = clonePlayers(players).map(player => ({
      ...player,
      marks: Object.fromEntries(this.targets.map(target => [target, 0])),
    }));
  }

  getCurrentPlayerId() {
    return this.players[this.currentPlayerIndex].id;
  }

  getScoreBoard() {
    return { players: clonePlayers(this.players) };
  }

  applyRound(throws: ThrowResult[]): RoundResult {
    const player = this.players[this.currentPlayerIndex];
    let roundScore = 0;
    const marks = { ...(player.marks ?? {}) };

    throws.forEach(throwResult => {
      const sector =
        throwResult.label === 'OB' || throwResult.label === 'IB'
          ? '25'
          : `${parseInt(throwResult.label.replace(/^[DST]/, ''), 10) || 0}`;
      if (!this.targets.includes(sector)) {
        return;
      }

      const multiplier =
        throwResult.ring === 'triple'
          ? 3
          : throwResult.ring === 'double' || throwResult.ring === 'innerBull'
            ? 2
            : 1;
      const currentMarks = marks[sector] ?? 0;
      const newMarks = Math.min(currentMarks + multiplier, 3);
      const extraMarks = Math.max(0, currentMarks + multiplier - 3);
      marks[sector] = newMarks;

      if (
        extraMarks > 0 &&
        this.players
          .filter(candidate => candidate.id !== player.id)
          .some(candidate => (candidate.marks?.[sector] ?? 0) < 3)
      ) {
        roundScore += Number(sector) * extraMarks;
      }
    });

    player.marks = marks;
    player.score += roundScore;
    player.roundScores = [...player.roundScores, roundScore];

    const allClosed = this.targets.every(target => (player.marks?.[target] ?? 0) >= 3);
    const highestOpponentScore = Math.max(
      ...this.players
        .filter(candidate => candidate.id !== player.id)
        .map(candidate => candidate.score),
      0,
    );

    if (allClosed && player.score >= highestOpponentScore) {
      this.winnerId = player.id;
    } else {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    }

    return {
      playerId: player.id,
      playerName: player.name,
      throws,
      roundScore,
    };
  }

  isGameOver() {
    return this.winnerId !== null;
  }

  getWinnerId() {
    return this.winnerId;
  }

  getCurrentRoundNumber() {
    // Counted per player: once seat 1 has thrown, seat 2 is still in the same round.
    // The winner stays current, so after a win this is the winning round.
    const roundsPlayed = this.players[this.currentPlayerIndex].roundScores.length;
    return roundsPlayed + (this.winnerId ? 0 : 1);
  }

  reset() {
    this.currentPlayerIndex = 0;
    this.winnerId = null;
    this.players.forEach(player => {
      player.score = 0;
      player.roundScores = [];
      player.marks = Object.fromEntries(this.targets.map(target => [target, 0]));
    });
  }
}

// Targets 1-20 in order, then bull; any ring of the current target advances one step.
export const AROUND_THE_CLOCK_TARGETS = [...BOARD_SECTORS, 25];

export const getAroundTheClockTarget = (progress: number) =>
  AROUND_THE_CLOCK_TARGETS[progress] ?? null;

class AroundTheClockEngine implements GameEngine {
  readonly type = 'aroundTheClock' as const;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private winnerId: string | null = null;

  constructor(players: PlayerSummary[]) {
    this.players = clonePlayers(players).map(player => ({ ...player, score: 0 }));
  }

  getCurrentPlayerId() {
    return this.players[this.currentPlayerIndex].id;
  }

  getScoreBoard() {
    return { players: clonePlayers(this.players) };
  }

  applyRound(throws: ThrowResult[]): RoundResult {
    const player = this.players[this.currentPlayerIndex];
    let hits = 0;

    throws.forEach(throwResult => {
      const target = getAroundTheClockTarget(player.score);
      if (target !== null && getThrowSector(throwResult) === target) {
        player.score += 1;
        hits += 1;
      }
    });

    player.roundScores = [...player.roundScores, hits];
    if (player.score >= AROUND_THE_CLOCK_TARGETS.length) {
      this.winnerId = player.id;
    } else {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    }

    return {
      playerId: player.id,
      playerName: player.name,
      throws,
      roundScore: hits,
    };
  }

  isGameOver() {
    return this.winnerId !== null;
  }

  getWinnerId() {
    return this.winnerId;
  }

  getCurrentRoundNumber() {
    // Counted per player: once seat 1 has thrown, seat 2 is still in the same round.
    // The winner stays current, so after a win this is the winning round.
    const roundsPlayed = this.players[this.currentPlayerIndex].roundScores.length;
    return roundsPlayed + (this.winnerId ? 0 : 1);
  }

  reset() {
    this.currentPlayerIndex = 0;
    this.winnerId = null;
    this.players.forEach(player => {
      player.score = 0;
      player.roundScores = [];
    });
  }
}

let engine: GameEngine | null = null;

export const createGameEngine = (type: GameType, players: PlayerSummary[]) => {
  switch (type) {
    case 'highScore':
    case 'darts99':
      engine = new HighScoreEngine(type, players);
      break;
    case 'cricket':
      engine = new CricketEngine(players);
      break;
    case 'aroundTheClock':
      engine = new AroundTheClockEngine(players);
      break;
    default:
      engine = new X01Engine(type, players);
  }
  return engine;
};

export const getGameEngine = () => engine;

export const resetGameEngine = () => {
  engine?.reset();
  engine = null;
};
