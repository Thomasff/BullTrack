import { createGameEngine } from '../src/application/services/gameRules';
import { createThrow } from '../src/domain/game/throws';
import type { PlayerSummary } from '../src/domain/game/types';
import { findDuplicatePlayerName, resolvePlayerNames } from '../src/domain/game/players';

const players = (count: number): PlayerSummary[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `P${index + 1}`,
    score: 0,
    roundScores: [],
  }));

const T = (sector: number) => createThrow('triple', sector);
const D = (sector: number) => createThrow('double', sector);
const S = (sector: number) => createThrow('single', sector);
const MISS = () => createThrow('miss');

describe('X01', () => {
  test('subtracts round score and rotates players', () => {
    const engine = createGameEngine('game301', players(2));
    const result = engine.applyRound([T(20), T(20), S(1)]);
    expect(result.roundScore).toBe(121);
    expect(engine.getScoreBoard().players[0].score).toBe(180);
    expect(engine.getCurrentPlayerId()).toBe('player-2');
  });

  test('bust keeps score when going below zero or to one', () => {
    const engine = createGameEngine('game301', players(1));
    engine.applyRound([T(20), T(20), T(20)]); // 121
    engine.applyRound([T(20), T(20), MISS()]); // 1 -> bust
    expect(engine.getScoreBoard().players[0].score).toBe(121);
    engine.applyRound([T(20), T(20), T(20)]); // -59 -> bust
    expect(engine.getScoreBoard().players[0].score).toBe(121);
    expect(engine.isGameOver()).toBe(false);
  });

  test('checkout requires a double or inner bull', () => {
    const engine = createGameEngine('game301', players(1));
    engine.applyRound([T(20), T(20), T(20)]); // 121
    engine.applyRound([T(20), T(20), S(1)]); // 0 with single -> bust
    expect(engine.getScoreBoard().players[0].score).toBe(121);
    engine.applyRound([T(20), T(17), createThrow('innerBull')]); // 60+51+50 = 161 -> bust
    engine.applyRound([T(20), T(7), D(20)]); // 60+21+40 = 121 -> win
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getWinnerId()).toBe('player-1');
  });

  test('701 starts at 701', () => {
    const engine = createGameEngine('game701', players(1));
    expect(engine.getScoreBoard().players[0].score).toBe(701);
  });
});

describe('Cricket', () => {
  test('closing all targets with enough points wins', () => {
    const engine = createGameEngine('cricket', players(1));
    engine.applyRound([T(15), T(16), T(17)]);
    engine.applyRound([T(18), T(19), T(20)]);
    expect(engine.isGameOver()).toBe(false);
    engine.applyRound([createThrow('innerBull'), createThrow('outerBull'), MISS()]);
    expect(engine.isGameOver()).toBe(true);
  });

  test('extra marks score only while an opponent is still open', () => {
    const engine = createGameEngine('cricket', players(2));
    const result = engine.applyRound([T(20), T(20), MISS()]);
    expect(result.roundScore).toBe(60);
  });
});

describe('High score', () => {
  test('ends after ten rounds per player', () => {
    const engine = createGameEngine('highScore', players(2));
    for (let i = 0; i < 19; i += 1) {
      engine.applyRound([S(1), S(1), S(1)]);
    }
    expect(engine.isGameOver()).toBe(false);
    engine.applyRound([S(20), S(20), S(20)]);
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getWinnerId()).toBe('player-2');
  });
});

describe('Player names', () => {


  test('empty names fall back to seat defaults', () => {
    expect(resolvePlayerNames(['', 'Bob '])).toEqual(['玩家 1', 'Bob']);
  });

  test('detects duplicates after trimming and defaults', () => {
    expect(findDuplicatePlayerName(['Bob', ' Bob'])).toBe('Bob');
    expect(findDuplicatePlayerName(['', '玩家 1'])).toBe('玩家 1');
    expect(findDuplicatePlayerName(['A', 'B'])).toBeNull();
  });
});

describe('Around the clock', () => {
  test('advances one target per hit of any ring, in order', () => {
    const engine = createGameEngine('aroundTheClock', players(1));
    const result = engine.applyRound([T(1), S(3), D(2)]); // hit 1, miss 3, hit 2
    expect(result.roundScore).toBe(2);
    expect(engine.getScoreBoard().players[0].score).toBe(2);
  });

  test('finishing on bull wins', () => {
    const engine = createGameEngine('aroundTheClock', players(2));
    for (let target = 1; target <= 20; target += 3) {
      engine.applyRound([S(target), S(target + 1), S(target + 2)].filter((_, i) => target + i <= 20));
      if (!engine.isGameOver()) {
        engine.applyRound([MISS(), MISS(), MISS()]); // player 2
      }
    }
    expect(engine.getScoreBoard().players[0].score).toBe(20);
    engine.applyRound([createThrow('outerBull'), MISS(), MISS()]);
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getWinnerId()).toBe('player-1');
  });
});

describe('99 darts at 20', () => {
  test('only hits on 20 score and the game lasts 33 rounds', () => {
    const engine = createGameEngine('darts99', players(1));
    const first = engine.applyRound([T(20), S(1), D(20)]);
    expect(first.roundScore).toBe(100);
    for (let i = 1; i < 32; i += 1) {
      engine.applyRound([MISS(), MISS(), MISS()]);
    }
    expect(engine.isGameOver()).toBe(false);
    engine.applyRound([S(20), MISS(), MISS()]);
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getScoreBoard().players[0].score).toBe(120);
  });
});

describe('Round number', () => {
  test.each(['game301', 'cricket', 'aroundTheClock', 'highScore'] as const)(
    '%s counts rounds per player, not ahead of later seats',
    type => {
      const engine = createGameEngine(type, players(2));
      expect(engine.getCurrentRoundNumber()).toBe(1);
      engine.applyRound([S(1), S(1), S(1)]);
      expect(engine.getCurrentRoundNumber()).toBe(1);
      engine.applyRound([S(1), S(1), S(1)]);
      expect(engine.getCurrentRoundNumber()).toBe(2);
    },
  );
});
