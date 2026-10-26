import type {
  GameType,
  KillerState,
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
    killer: player.killer ? { ...player.killer } : undefined,
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

type CricketType = 'cricket' | 'cricketNoScore' | 'tactics' | 'cutThroat';

const CRICKET_TARGETS = ['15', '16', '17', '18', '19', '20', '25'];
const TACTICS_TARGETS = ['10', '11', '12', '13', '14', ...CRICKET_TARGETS];

export const isCricketType = (type: GameType | null): type is CricketType =>
  type === 'cricket' || type === 'cricketNoScore' || type === 'tactics' || type === 'cutThroat';

// '25' is the bull.
export const getCricketTargets = (type: CricketType) =>
  type === 'tactics' ? TACTICS_TARGETS : CRICKET_TARGETS;

// Standard and Tactics score extra marks for yourself, Cut Throat gives them to every
// opponent still open on that target (lowest score wins), No Score only races to close.
class CricketEngine implements GameEngine {
  readonly type: CricketType;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private winnerId: string | null = null;
  private readonly targets: string[];

  constructor(type: CricketType, players: PlayerSummary[]) {
    this.type = type;
    this.targets = getCricketTargets(type);
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
    const opponents = this.players.filter(candidate => candidate.id !== player.id);
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

      const openOpponents = opponents.filter(
        candidate => (candidate.marks?.[sector] ?? 0) < 3,
      );
      if (extraMarks === 0 || openOpponents.length === 0 || this.type === 'cricketNoScore') {
        return;
      }
      const points = Number(sector) * extraMarks;
      if (this.type === 'cutThroat') {
        openOpponents.forEach(candidate => {
          candidate.score += points;
        });
      }
      roundScore += points;
    });

    player.marks = marks;
    if (this.type !== 'cutThroat') {
      player.score += roundScore;
    }
    player.roundScores = [...player.roundScores, roundScore];

    const allClosed = this.targets.every(target => (player.marks?.[target] ?? 0) >= 3);
    const opponentScores = opponents.map(candidate => candidate.score);
    const isAhead =
      this.type === 'cricketNoScore' ||
      (this.type === 'cutThroat'
        ? player.score <= Math.min(...opponentScores)
        : player.score >= Math.max(...opponentScores, 0));

    if (allClosed && isAhead) {
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

export const SHANGHAI_ROUNDS = 7;

// Half it and Bermuda: hit the round's target or your score is halved. 25 is either bull.
export type HalfItTarget = number | 'double' | 'triple' | 'innerBull';
export const HALF_IT_TARGETS: HalfItTarget[] = [15, 16, 'double', 17, 18, 'triple', 19, 20, 25];
export const HALF_IT_START_SCORE = 40;
export const BERMUDA_TARGETS: HalfItTarget[] = [
  12, 13, 14, 'double', 15, 16, 17, 'triple', 18, 19, 20, 25, 'innerBull',
];

export type TargetRoundsType = 'shanghai' | 'halfIt' | 'bermuda';

// The target a side throws at in its round with the given number (1-based); null once done.
export const getRoundTarget = (
  type: TargetRoundsType,
  roundNumber: number,
): HalfItTarget | null => {
  if (type === 'shanghai') {
    return roundNumber <= SHANGHAI_ROUNDS ? roundNumber : null;
  }
  const targets = type === 'bermuda' ? BERMUDA_TARGETS : HALF_IT_TARGETS;
  return targets[roundNumber - 1] ?? null;
};

const hitsTarget = (throwResult: ThrowResult, target: HalfItTarget) => {
  if (target === 'double') {
    return throwResult.ring === 'double' || throwResult.ring === 'innerBull';
  }
  if (target === 'triple') {
    return throwResult.ring === 'triple';
  }
  if (target === 'innerBull') {
    return throwResult.ring === 'innerBull';
  }
  return getThrowSector(throwResult) === target;
};

// Every round has its own target and only darts on it score. Shanghai: round N aims at N,
// and single + double + triple of N in one round wins at once. Half it and Bermuda: missing
// the target with all three darts halves the score; in the Bermuda bull round either bull is
// worth 25. After the last round the highest score wins.
class TargetRoundsEngine implements GameEngine {
  readonly type: TargetRoundsType;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private winnerId: string | null = null;
  private readonly startScore: number;
  private readonly totalRounds: number;

  constructor(type: TargetRoundsType, players: PlayerSummary[]) {
    this.type = type;
    this.startScore = type === 'halfIt' ? HALF_IT_START_SCORE : 0;
    this.totalRounds =
      type === 'shanghai'
        ? SHANGHAI_ROUNDS
        : type === 'bermuda'
          ? BERMUDA_TARGETS.length
          : HALF_IT_TARGETS.length;
    this.players = clonePlayers(players).map(player => ({ ...player, score: this.startScore }));
  }

  private scoreHit(throwResult: ThrowResult, target: HalfItTarget) {
    return this.type === 'bermuda' && target === 25 ? 25 : throwResult.score;
  }

  getCurrentPlayerId() {
    return this.players[this.currentPlayerIndex].id;
  }

  getScoreBoard() {
    return { players: clonePlayers(this.players) };
  }

  applyRound(throws: ThrowResult[]): RoundResult {
    const player = this.players[this.currentPlayerIndex];
    const target = getRoundTarget(this.type, player.roundScores.length + 1) ?? 0;
    const hits = throws.filter(throwResult => hitsTarget(throwResult, target));
    let roundScore = hits.reduce((sum, throwResult) => sum + this.scoreHit(throwResult, target), 0);
    if (this.type !== 'shanghai' && hits.length === 0) {
      roundScore = Math.floor(player.score / 2) - player.score;
    }
    player.score += roundScore;
    player.roundScores = [...player.roundScores, roundScore];

    const rings = new Set(hits.map(throwResult => throwResult.ring));
    const isShanghai =
      this.type === 'shanghai' && rings.has('single') && rings.has('double') && rings.has('triple');
    if (isShanghai) {
      this.winnerId = player.id;
    } else {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      if (this.players.every(candidate => candidate.roundScores.length >= this.totalRounds)) {
        this.winnerId =
          [...this.players].sort((left, right) => right.score - left.score)[0]?.id ?? null;
      }
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
    const roundsPlayed = this.players[this.currentPlayerIndex].roundScores.length;
    return roundsPlayed + (this.winnerId ? 0 : 1);
  }

  reset() {
    this.currentPlayerIndex = 0;
    this.winnerId = null;
    this.players.forEach(player => {
      player.score = this.startScore;
      player.roundScores = [];
    });
  }
}

export const KILLER_LIVES = 3;

// Small deterministic PRNG (Park-Miller), so replaying a game for undo deals the same numbers.
const RANDOM_MODULUS = 2147483647;
const createRandom = (seed: number) => {
  let state = (Math.abs(Math.floor(seed)) % (RANDOM_MODULUS - 1)) + 1;
  return () => {
    state = (state * 48271) % RANDOM_MODULUS;
    return (state - 1) / (RANDOM_MODULUS - 1);
  };
};

const newKillerState = (number: number): KillerState => ({
  number,
  lives: KILLER_LIVES,
  isKiller: false,
});

// Every side gets its own random number. Hitting the double of your number makes you a
// killer; a killer's hits on an opponent's double take one of their lives, and a killer
// hitting their own double loses a life. The last side with lives left wins.
class KillerEngine implements GameEngine {
  readonly type = 'killer' as const;
  private readonly players: PlayerSummary[];
  private currentPlayerIndex = 0;
  private winnerId: string | null = null;
  private readonly numbers: number[];

  constructor(players: PlayerSummary[], seed: number) {
    const random = createRandom(seed);
    const pool = [...BOARD_SECTORS];
    this.numbers = players.map(() => pool.splice(Math.floor(random() * pool.length), 1)[0]);
    this.players = clonePlayers(players).map((player, index) => ({
      ...player,
      score: 0,
      killer: newKillerState(this.numbers[index]),
    }));
  }

  private stateOf(player: PlayerSummary) {
    return player.killer ?? newKillerState(0);
  }

  getCurrentPlayerId() {
    return this.players[this.currentPlayerIndex].id;
  }

  getScoreBoard() {
    return { players: clonePlayers(this.players) };
  }

  applyRound(throws: ThrowResult[]): RoundResult {
    const player = this.players[this.currentPlayerIndex];
    const own = this.stateOf(player);
    let lifeHits = 0;

    for (const throwResult of throws) {
      if (this.winnerId !== null || own.lives <= 0) {
        break;
      }
      if (throwResult.ring !== 'double') {
        continue;
      }
      const sector = getThrowSector(throwResult);
      if (sector === own.number) {
        if (own.isKiller) {
          own.lives -= 1;
        } else {
          own.isKiller = true;
        }
      } else if (own.isKiller) {
        const victim = this.players
          .map(candidate => this.stateOf(candidate))
          .find(state => state.number === sector && state.lives > 0);
        if (victim) {
          victim.lives -= 1;
          lifeHits += 1;
        }
      }
      const alive = this.players.filter(candidate => this.stateOf(candidate).lives > 0);
      if (alive.length === 1) {
        this.winnerId = alive[0].id;
      }
    }

    player.roundScores = [...player.roundScores, lifeHits];
    if (this.winnerId === null) {
      this.advanceToNextAlive();
    } else {
      // The winner stays current, like the other games.
      this.currentPlayerIndex = this.players.findIndex(
        candidate => candidate.id === this.winnerId,
      );
    }

    return {
      playerId: player.id,
      playerName: player.name,
      throws,
      roundScore: lifeHits,
    };
  }

  private advanceToNextAlive() {
    for (let step = 1; step <= this.players.length; step += 1) {
      const index = (this.currentPlayerIndex + step) % this.players.length;
      if (this.stateOf(this.players[index]).lives > 0) {
        this.currentPlayerIndex = index;
        return;
      }
    }
  }

  isGameOver() {
    return this.winnerId !== null;
  }

  getWinnerId() {
    return this.winnerId;
  }

  getCurrentRoundNumber() {
    const roundsPlayed = this.players[this.currentPlayerIndex].roundScores.length;
    return roundsPlayed + (this.winnerId ? 0 : 1);
  }

  reset() {
    this.currentPlayerIndex = 0;
    this.winnerId = null;
    this.players.forEach((player, index) => {
      player.roundScores = [];
      player.killer = newKillerState(this.numbers[index]);
    });
  }
}

export const GOTCHA_TARGET = 301;

// Count up from 0 to exactly 301, no double needed. A dart that brings you level with an
// opponent sends that opponent back to 0. Going over 301 is a bust: the whole round is void,
// the resets it caused included.
class GotchaEngine implements GameEngine {
  readonly type = 'gotcha301' as const;
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
    const scoresBefore = this.players.map(candidate => candidate.score);
    let score = player.score;
    let bust = false;

    for (const throwResult of throws) {
      if (throwResult.score === 0) {
        continue;
      }
      score += throwResult.score;
      if (score > GOTCHA_TARGET) {
        bust = true;
        break;
      }
      this.players.forEach(candidate => {
        if (candidate.id !== player.id && candidate.score === score) {
          candidate.score = 0;
        }
      });
      if (score === GOTCHA_TARGET) {
        this.winnerId = player.id;
        break;
      }
    }

    if (bust) {
      this.players.forEach((candidate, index) => {
        candidate.score = scoresBefore[index];
      });
    } else {
      player.score = score;
    }
    const roundScore = player.score - scoresBefore[this.currentPlayerIndex];
    player.roundScores = [...player.roundScores, roundScore];
    if (this.winnerId === null) {
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

// seed only matters for games that deal something at random (Killer numbers); pass the same
// seed when rebuilding the same game.
export const createGameEngine = (type: GameType, players: PlayerSummary[], seed = 0) => {
  switch (type) {
    case 'highScore':
    case 'darts99':
      engine = new HighScoreEngine(type, players);
      break;
    case 'cricket':
    case 'cricketNoScore':
    case 'tactics':
    case 'cutThroat':
      engine = new CricketEngine(type, players);
      break;
    case 'aroundTheClock':
      engine = new AroundTheClockEngine(players);
      break;
    case 'shanghai':
    case 'halfIt':
    case 'bermuda':
      engine = new TargetRoundsEngine(type, players);
      break;
    case 'killer':
      engine = new KillerEngine(players, seed);
      break;
    case 'gotcha301':
      engine = new GotchaEngine(players);
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
