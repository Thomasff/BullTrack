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
  test.each(
    [
      'game301',
      'cricket',
      'cutThroat',
      'aroundTheClock',
      'highScore',
      'shanghai',
      'halfIt',
      'bermuda',
      'killer',
      'gotcha301',
      'randomCricket',
      'hammerCricket',
      'catch40',
      'checkout4160',
    ] as const,
  )(
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

describe('Cricket variants', () => {
  test('No Score Cricket never scores and closing everything wins', () => {
    const engine = createGameEngine('cricketNoScore', players(2));
    expect(engine.applyRound([T(20), T(20), T(20)]).roundScore).toBe(0);
    engine.applyRound([T(20), T(20), T(20)]); // P2 builds marks, still no points
    engine.applyRound([T(15), T(16), T(17)]);
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([T(18), T(19), MISS()]);
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([createThrow('innerBull'), createThrow('outerBull'), MISS()]);
    expect(engine.getWinnerId()).toBe('player-1');
    expect(engine.getScoreBoard().players.every(player => player.score === 0)).toBe(true);
  });

  test('Tactics also needs 10-14', () => {
    const engine = createGameEngine('tactics', players(1));
    engine.applyRound([T(15), T(16), T(17)]);
    engine.applyRound([T(18), T(19), T(20)]);
    engine.applyRound([createThrow('innerBull'), createThrow('outerBull'), MISS()]);
    expect(engine.isGameOver()).toBe(false);
    engine.applyRound([T(10), T(11), T(12)]);
    engine.applyRound([T(13), T(14), MISS()]);
    expect(engine.getWinnerId()).toBe('player-1');
  });

  test('Cut Throat gives extra marks to every opponent still open on that target', () => {
    const engine = createGameEngine('cutThroat', players(3));
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([T(20), MISS(), MISS()]); // P2 closes 20
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([T(20), T(20), MISS()]); // P1: 60 goes to P3 only
    const scores = engine.getScoreBoard().players.map(player => player.score);
    expect(scores).toEqual([0, 0, 60]);
  });

  test('Cut Throat: closing everything with a higher score does not win', () => {
    const engine = createGameEngine('cutThroat', players(2));
    engine.applyRound([T(20), MISS(), MISS()]);
    engine.applyRound([T(19), T(19), MISS()]); // P1 gets 57
    engine.applyRound([T(15), T(16), T(17)]);
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([T(18), T(19), createThrow('innerBull')]);
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([createThrow('outerBull'), MISS(), MISS()]); // P1 all closed, 57 > 0
    expect(engine.isGameOver()).toBe(false);
  });
});

describe('Shanghai', () => {
  test('round N only scores on N', () => {
    const engine = createGameEngine('shanghai', players(1));
    expect(engine.applyRound([S(1), D(1), S(2)]).roundScore).toBe(3);
    expect(engine.applyRound([T(2), S(1), MISS()]).roundScore).toBe(6);
  });

  test('single, double and triple of the target in one round wins at once', () => {
    const engine = createGameEngine('shanghai', players(2));
    engine.applyRound([T(1), D(1), S(1)]);
    expect(engine.getWinnerId()).toBe('player-1');
  });

  test('after seven rounds the highest score wins', () => {
    const engine = createGameEngine('shanghai', players(2));
    for (let round = 1; round <= 7; round += 1) {
      engine.applyRound([S(round), MISS(), MISS()]);
      expect(engine.isGameOver()).toBe(false);
      engine.applyRound([T(round), MISS(), MISS()]);
    }
    expect(engine.getWinnerId()).toBe('player-2');
  });
});

describe('Half it', () => {
  test('hits add their score, a round without a hit halves the total', () => {
    const engine = createGameEngine('halfIt', players(1));
    expect(engine.getScoreBoard().players[0].score).toBe(40);
    engine.applyRound([S(15), T(15), S(20)]); // target 15
    expect(engine.getScoreBoard().players[0].score).toBe(100);
    expect(engine.applyRound([S(15), MISS(), MISS()]).roundScore).toBe(-50); // target 16
    engine.applyRound([D(5), createThrow('innerBull'), S(3)]); // any double: 10 + 50
    expect(engine.getScoreBoard().players[0].score).toBe(110);
  });

  test('ends after nine rounds', () => {
    const engine = createGameEngine('halfIt', players(1));
    for (let round = 0; round < 8; round += 1) {
      engine.applyRound([MISS(), MISS(), MISS()]);
    }
    expect(engine.isGameOver()).toBe(false);
    engine.applyRound([MISS(), MISS(), MISS()]);
    expect(engine.getWinnerId()).toBe('player-1');
  });
});

describe('Bermuda', () => {
  test('starts at 0, scores hits on the target and halves a round without one', () => {
    const engine = createGameEngine('bermuda', players(1));
    expect(engine.getScoreBoard().players[0].score).toBe(0);
    expect(engine.applyRound([S(12), T(12), S(20)]).roundScore).toBe(48); // target 12
    expect(engine.applyRound([S(12), MISS(), MISS()]).roundScore).toBe(-24); // target 13
    engine.applyRound([S(14), MISS(), MISS()]); // 38
    engine.applyRound([D(5), createThrow('innerBull'), S(3)]); // any double: 10 + 50
    expect(engine.getScoreBoard().players[0].score).toBe(98);
  });

  test('either bull is worth 25 in the bull round, only the inner bull counts in the last', () => {
    const engine = createGameEngine('bermuda', players(1));
    for (let round = 0; round < 11; round += 1) {
      engine.applyRound([MISS(), MISS(), MISS()]);
    }
    const bulls = [createThrow('innerBull'), createThrow('outerBull'), MISS()];
    expect(engine.applyRound(bulls).roundScore).toBe(50);
    expect(engine.isGameOver()).toBe(false);
    expect(engine.applyRound(bulls).roundScore).toBe(50); // inner bull only
    expect(engine.getScoreBoard().players[0].score).toBe(100);
    expect(engine.getWinnerId()).toBe('player-1');
  });
});

describe('Gotcha 301', () => {
  test('counts up and wins on exactly 301 without a double', () => {
    const engine = createGameEngine('gotcha301', players(1));
    engine.applyRound([T(20), T(20), T(20)]); // 180
    engine.applyRound([T(20), T(20), S(1)]); // 301
    expect(engine.getWinnerId()).toBe('player-1');
  });

  test('going over 301 voids the round', () => {
    const engine = createGameEngine('gotcha301', players(1));
    engine.applyRound([T(20), T(20), T(20)]); // 180
    engine.applyRound([T(20), T(20), MISS()]); // 300
    expect(engine.applyRound([D(1), MISS(), MISS()]).roundScore).toBe(0); // 302
    expect(engine.getScoreBoard().players[0].score).toBe(300);
    expect(engine.isGameOver()).toBe(false);
  });

  test('landing on an opponent score sends them back to 0, unless the round busts', () => {
    const engine = createGameEngine('gotcha301', players(2));
    engine.applyRound([S(20), MISS(), MISS()]); // P1 20
    engine.applyRound([S(10), S(10), MISS()]); // P2 reaches 20 with its second dart
    expect(engine.getScoreBoard().players.map(player => player.score)).toEqual([0, 20]);
  });

  test('a bust also undoes the resets earlier in the round', () => {
    const engine = createGameEngine('gotcha301', players(2));
    engine.applyRound([T(20), T(20), T(20)]); // P1 180
    engine.applyRound([T(20), T(20), MISS()]); // P2 120
    engine.applyRound([T(20), T(20), MISS()]); // P1 300
    engine.applyRound([T(20), T(20), MISS()]); // P2 240
    engine.applyRound([MISS(), MISS(), MISS()]); // P1
    engine.applyRound([T(20), D(1), MISS()]); // P2 300 sends P1 to 0, then 302 busts
    expect(engine.getScoreBoard().players.map(player => player.score)).toEqual([300, 240]);
  });
});

describe('Killer', () => {
  const numbersOf = (engine: ReturnType<typeof createGameEngine>) =>
    engine.getScoreBoard().players.map(player => player.killer?.number ?? 0);

  test('the same seed deals the same distinct numbers', () => {
    const first = numbersOf(createGameEngine('killer', players(4), 12345));
    expect(numbersOf(createGameEngine('killer', players(4), 12345))).toEqual(first);
    expect(new Set(first).size).toBe(4);
    first.forEach(number => expect(number >= 1 && number <= 20).toBe(true));
  });

  test('become a killer on your own double, then take lives on the others', () => {
    const engine = createGameEngine('killer', players(2), 7);
    const [own, other] = numbersOf(engine);
    engine.applyRound([D(other), D(own), D(other)]); // first dart does nothing yet
    let [, second] = engine.getScoreBoard().players;
    expect(second.killer?.lives).toBe(2);
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([D(other), D(other), S(other)]);
    [, second] = engine.getScoreBoard().players;
    expect(second.killer?.lives).toBe(0);
    expect(engine.getWinnerId()).toBe('player-1');
  });

  test('a killer hitting their own double loses a life, and players out are skipped', () => {
    const engine = createGameEngine('killer', players(3), 99);
    const [own, , third] = numbersOf(engine);
    engine.applyRound([D(own), D(third), D(third)]);
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([MISS(), MISS(), MISS()]);
    engine.applyRound([D(third), D(own), MISS()]); // P3 out, P1 down to 2 lives
    const board = engine.getScoreBoard().players;
    expect(board[0].killer?.lives).toBe(2);
    expect(board[2].killer?.lives).toBe(0);
    expect(engine.isGameOver()).toBe(false);
    engine.applyRound([MISS(), MISS(), MISS()]); // P2
    expect(engine.getCurrentPlayerId()).toBe('player-1');
  });
});

describe('Random Cricket', () => {
  const targetsOf = (engine: ReturnType<typeof createGameEngine>) =>
    Object.keys(engine.getScoreBoard().players[0].marks ?? {});

  test('the same seed draws the same six different numbers plus the bull', () => {
    const targets = targetsOf(createGameEngine('randomCricket', players(2), 2024));
    expect(targetsOf(createGameEngine('randomCricket', players(2), 2024))).toEqual(targets);
    expect(targets).toHaveLength(7);
    expect(targets).toContain('25');
    const numbers = targets.filter(target => target !== '25').map(Number);
    expect(new Set(numbers).size).toBe(6);
    numbers.forEach(number => expect(number >= 1 && number <= 20).toBe(true));
  });

  test('only the drawn numbers take marks and score', () => {
    const engine = createGameEngine('randomCricket', players(2), 31);
    const drawn = targetsOf(engine).filter(target => target !== '25').map(Number);
    const notDrawn = [...Array(20).keys()].map(index => index + 1).find(n => !drawn.includes(n)) ?? 1;
    const result = engine.applyRound([T(drawn[0]), S(drawn[0]), T(notDrawn)]);
    expect(result.roundScore).toBe(drawn[0]);
    const marks = engine.getScoreBoard().players[0].marks ?? {};
    expect(marks[`${drawn[0]}`]).toBe(3);
    expect(marks[`${notDrawn}`]).toBeUndefined();
  });
});

describe('Hammer cricket', () => {
  test('darts count by their place in the round and a full miss drops the hammer', () => {
    const engine = createGameEngine('hammerCricket', players(2), 5);
    // Arachnid's example: miss, single 20 (x2), triple 20 (x3) = 220.
    expect(engine.applyRound([MISS(), S(20), T(20)]).roundScore).toBe(220);
    expect(engine.applyRound([S(19), S(12), S(1)]).roundScore).toBe(-60);
    const [first, second] = engine.getScoreBoard().players;
    expect([first.score, second.score]).toEqual([220, -60]);
    expect(first.target).toBe(19);
  });

  test('the last round multiplies by 1, 3 and 5 and the highest total wins', () => {
    const engine = createGameEngine('hammerCricket', players(1), 77);
    for (let round = 1; round < 8; round += 1) {
      engine.applyRound([MISS(), MISS(), MISS()]);
    }
    const target = engine.getScoreBoard().players[0].target ?? 0;
    expect([12, 13, 14, 15, 16, 17, 18, 19, 20, 25]).toContain(target);
    const hit = target === 25 ? createThrow('outerBull') : S(target);
    expect(engine.applyRound([hit, hit, hit]).roundScore).toBe(9 * hit.score);
    expect(engine.getWinnerId()).toBe('player-1');
    expect(engine.getScoreBoard().players[0].target).toBeNull();
  });
});

describe('Catch 40', () => {
  test('a 2-dart finish scores 3 and moves on to the next number', () => {
    const engine = createGameEngine('catch40', players(1));
    expect(engine.applyRound([S(11), createThrow('innerBull')]).roundScore).toBe(3);
    expect(engine.getScoreBoard().players[0].checkout).toEqual({
      target: 62,
      remaining: 62,
      dartsUsed: 0,
    });
  });

  test('a bust voids the visit, and a 6-dart finish scores 1', () => {
    const engine = createGameEngine('catch40', players(1));
    engine.applyRound([T(20), MISS(), MISS()]); // 61 -> 1: bust
    expect(engine.getScoreBoard().players[0].checkout?.remaining).toBe(61);
    expect(engine.applyRound([S(1), S(20), D(20)]).roundScore).toBe(1);
    expect(engine.getScoreBoard().players[0].checkout?.target).toBe(62);
  });

  test('no finish in six darts scores 0', () => {
    const engine = createGameEngine('catch40', players(1));
    engine.applyRound([S(1), MISS(), MISS()]);
    expect(engine.applyRound([S(20), S(20), MISS()]).roundScore).toBe(0);
    expect(engine.getScoreBoard().players[0].checkout?.target).toBe(62);
  });
});

describe('41-60', () => {
  test('one visit per number: 2 darts score 2, 3 darts 1, otherwise 0', () => {
    const engine = createGameEngine('checkout4160', players(1));
    expect(engine.applyRound([S(9), D(16)]).roundScore).toBe(2); // 41
    expect(engine.applyRound([S(2), S(10), D(15)]).roundScore).toBe(1); // 42
    expect(engine.applyRound([S(3), MISS(), MISS()]).roundScore).toBe(0); // 43
    expect(engine.getScoreBoard().players[0].checkout?.target).toBe(44);
  });

  test('the game ends after 60', () => {
    const engine = createGameEngine('checkout4160', players(2));
    for (let visit = 0; visit < 40; visit += 1) {
      engine.applyRound(visit === 39 ? [S(20), D(20)] : [MISS(), MISS(), MISS()]);
    }
    expect(engine.getWinnerId()).toBe('player-2');
    expect(engine.getScoreBoard().players.map(player => player.checkout?.target)).toEqual([null, null]);
  });
});
