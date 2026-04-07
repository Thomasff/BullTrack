import type {
  GameType,
  PlayerSummary,
  RoundResult,
  ScoreBoard,
  ThrowResult,
} from '../../domain/game/types';

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

class HighScoreEngine implements GameEngine {
  readonly type = 'highScore' as const;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private completedRounds = 0;
  private readonly totalRounds = 10;

  constructor(players: PlayerSummary[]) {
    this.players = clonePlayers(players);
  }

  getCurrentPlayerId() {
    return this.players[this.currentPlayerIndex].id;
  }

  getScoreBoard() {
    return {
      players: [...this.players].sort((left, right) => right.score - left.score),
    };
  }

  applyRound(throws: ThrowResult[]): RoundResult {
    const player = this.players[this.currentPlayerIndex];
    const roundScore = throws.reduce((sum, item) => sum + item.score, 0);
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

class X01Engine implements GameEngine {
  readonly type: GameType;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private winnerId: string | null = null;
  private readonly startingScore: number;

  constructor(type: 'game301' | 'game501', players: PlayerSummary[]) {
    this.type = type;
    this.players = clonePlayers(players).map(player => ({
      ...player,
      score: type === 'game301' ? 301 : 501,
    }));
    this.startingScore = type === 'game301' ? 301 : 501;
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
    const roundsPlayed = Math.max(...this.players.map(player => player.roundScores.length), 0);
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
          .every(candidate => (candidate.marks?.[sector] ?? 0) >= 3)
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
    const roundsPlayed = Math.max(...this.players.map(player => player.roundScores.length), 0);
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

let engine: GameEngine | null = null;

export const createGameEngine = (type: GameType, players: PlayerSummary[]) => {
  engine =
    type === 'highScore'
      ? new HighScoreEngine(players)
      : type === 'cricket'
        ? new CricketEngine(players)
        : new X01Engine(type, players);
  return engine;
};

export const getGameEngine = () => engine;

export const resetGameEngine = () => {
  engine?.reset();
  engine = null;
};
