import { throwAt } from '../src/domain/game/boardGeometry';
import { createThrow } from '../src/domain/game/throws';

jest.mock('react-native-sqlite-storage', () => require('../jest/sqliteNodeAdapter'));

import {
  clearHistory,
  deleteMatch,
  deletePlayer,
  exportHistory,
  getHeadToHead,
  getMatchDetail,
  getPlayerDetail,
  getSetting,
  importHistory,
  listKnownPlayerNames,
  listPlayerStats,
  listRecentMatches,
  mergePlayerInto,
  renamePlayer,
  saveCompletedMatch,
  setSetting,
} from '../src/application/services/historyRepository';

const DAY = 24 * 60 * 60 * 1000;
const T20 = createThrow('triple', 20);
const S1 = createThrow('single', 1);
const D20 = createThrow('double', 20);

const saveSampleMatch = (createdAt: number) =>
  saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt,
    players: [
      { id: 'player-1', name: 'Alice' },
      { id: 'player-2', name: 'Bob' },
    ],
    winnerIds: ['player-1'],
    rounds: [
      { playerId: 'player-1', roundIndex: 1, throws: [T20, T20, T20] },
      { playerId: 'player-2', roundIndex: 1, throws: [S1, S1, S1] },
      { playerId: 'player-1', roundIndex: 2, throws: [T20, createThrow('triple', 7), D20] },
    ],
  });

beforeEach(async () => {
  await clearHistory();
});

test('saves a completed match and reads it back', async () => {
  await saveSampleMatch(1000);

  const recent = await listRecentMatches();
  expect(recent).toHaveLength(1);
  expect(recent[0]).toMatchObject({ modeLabel: '301', playerCount: 2, winnerName: 'Alice' });

  const detail = await getMatchDetail(recent[0].id);
  expect(detail?.players.map(player => [player.name, player.isWinner])).toEqual([
    ['Alice', true],
    ['Bob', false],
  ]);
  expect(detail?.rounds).toHaveLength(3);
  expect(detail?.rounds[2].throws.map(item => item.target)).toEqual(['20', '7', '20']);
  expect(detail?.rounds[2].throws[2]).toMatchObject({ score: 40, multiplier: 2 });
});

test('reuses players by name and aggregates stats', async () => {
  await saveSampleMatch(1000);
  await saveSampleMatch(2000);

  expect(await listKnownPlayerNames()).toEqual(expect.arrayContaining(['Alice', 'Bob']));

  const stats = await listPlayerStats();
  const alice = stats.find(item => item.name === 'Alice');
  const bob = stats.find(item => item.name === 'Bob');
  expect(alice).toMatchObject({ matchesPlayed: 2, wins: 2, bestRound: 180 });
  expect(alice?.x01Average).toBeCloseTo((180 + 121) / 2);
  expect(bob).toMatchObject({ matchesPlayed: 2, wins: 0, bestRound: 3, x01Average: 3 });
});

test('stores settings', async () => {
  expect(await getSetting('showDebug')).toBeNull();
  await setSetting('showDebug', '1');
  await setSetting('showDebug', '0');
  expect(await getSetting('showDebug')).toBe('0');
});

test('deletes one match and players left without matches', async () => {
  const keptId = await saveSampleMatch(1000);
  const removedId = await saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt: 2000,
    players: [{ id: 'player-1', name: 'Carol' }, { id: 'player-2', name: 'Alice' }],
    winnerIds: ['player-1'],
    rounds: [{ playerId: 'player-1', roundIndex: 1, throws: [T20, T20, T20] }],
  });
  expect(removedId).not.toBeNull();
  expect(removedId).not.toBe(keptId);

  await deleteMatch(removedId as number);
  expect((await listRecentMatches()).map(match => match.id)).toEqual([keptId]);
  expect(await listKnownPlayerNames()).not.toContain('Carol');
  expect(await getMatchDetail(removedId as number)).toBeNull();
  const alice = (await listPlayerStats()).find(item => item.name === 'Alice');
  expect(alice).toMatchObject({ matchesPlayed: 1, wins: 1 });
});

test('saves a team match: team per player, every winning member wins', async () => {
  const matchId = await saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt: 3000,
    players: [
      { id: 'player-1', name: 'Alice', teamIndex: 0 },
      { id: 'player-2', name: 'Bob', teamIndex: 0 },
      { id: 'player-3', name: 'Carol', teamIndex: 1 },
    ],
    winnerIds: ['player-1', 'player-2'],
    rounds: [
      { playerId: 'player-1', roundIndex: 1, throws: [T20, T20, T20] },
      { playerId: 'player-3', roundIndex: 1, throws: [S1, S1, S1] },
      { playerId: 'player-2', roundIndex: 2, throws: [T20, createThrow('triple', 7), D20] },
    ],
  });

  const recent = await listRecentMatches();
  expect(recent[0].playerCount).toBe(3);
  expect(recent[0].winnerName?.split('、').sort()).toEqual(['Alice', 'Bob']);

  const detail = await getMatchDetail(matchId as number);
  expect(detail?.players.map(player => [player.name, player.teamIndex, player.isWinner])).toEqual([
    ['Alice', 0, true],
    ['Bob', 0, true],
    ['Carol', 1, false],
  ]);

  const stats = await listPlayerStats();
  expect(stats.find(item => item.name === 'Bob')).toMatchObject({ wins: 1, bestRound: 121 });
  expect(stats.find(item => item.name === 'Alice')).toMatchObject({ wins: 1, bestRound: 180 });
  expect(stats.find(item => item.name === 'Carol')).toMatchObject({ wins: 0, bestRound: 3 });
});

const saveSoloMatch = (name: string, createdAt: number) =>
  saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt,
    players: [{ id: 'player-1', name }],
    winnerIds: ['player-1'],
    rounds: [{ playerId: 'player-1', roundIndex: 1, throws: [T20, T20, T20] }],
  });

const statsOf = async (name: string) =>
  (await listPlayerStats()).find(item => item.name === name);

test('player stats carry the last match time, and a null limit lists every match', async () => {
  await saveSampleMatch(1000);
  await saveSoloMatch('Alice', 5000);
  expect((await statsOf('Alice'))?.lastPlayedAt).toBe(5000);
  expect((await statsOf('Bob'))?.lastPlayedAt).toBe(1000);
  expect(await listRecentMatches(1)).toHaveLength(1);
  expect(await listRecentMatches(null)).toHaveLength(2);
});

test('renames a player and keeps their matches', async () => {
  await saveSampleMatch(1000);
  const alice = await statsOf('Alice');

  expect(await renamePlayer(alice!.playerId, ' Alicia ')).toBe('renamed');
  expect(await statsOf('Alice')).toBeUndefined();
  expect(await statsOf('Alicia')).toMatchObject({ matchesPlayed: 1, wins: 1 });
  expect((await listRecentMatches())[0].winnerName).toBe('Alicia');
});

test('renaming onto a taken name asks for a merge, which joins the matches', async () => {
  await saveSampleMatch(1000);
  await saveSoloMatch('Alise', 2000);
  const alise = await statsOf('Alise');

  expect(await renamePlayer(alise!.playerId, 'Alice')).toBe('nameTaken');
  expect(await mergePlayerInto(alise!.playerId, 'Alice')).toBe('merged');
  expect(await statsOf('Alise')).toBeUndefined();
  expect(await statsOf('Alice')).toMatchObject({ matchesPlayed: 2, wins: 2 });
  expect((await listRecentMatches()).map(match => match.winnerName)).toEqual(['Alice', 'Alice']);
});

test('players from the same match cannot be merged', async () => {
  await saveSampleMatch(1000);
  const bob = await statsOf('Bob');

  expect(await mergePlayerInto(bob!.playerId, 'Alice')).toBe('sharedMatch');
  expect(await statsOf('Bob')).toMatchObject({ matchesPlayed: 1 });
});

test('a deleted player is hidden but their matches stay, and playing again brings them back', async () => {
  await saveSampleMatch(1000);
  const bob = await statsOf('Bob');

  await deletePlayer(bob!.playerId);
  expect(await statsOf('Bob')).toBeUndefined();
  expect(await listKnownPlayerNames()).not.toContain('Bob');
  const recent = await listRecentMatches();
  expect(recent[0].playerCount).toBe(2);
  expect((await getMatchDetail(recent[0].id))?.players.map(player => player.name)).toEqual([
    'Alice',
    'Bob',
  ]);

  await saveSoloMatch('Bob', 2000);
  expect(await statsOf('Bob')).toMatchObject({ matchesPlayed: 2 });
  expect(await listKnownPlayerNames()).toContain('Bob');
});

test('unnamed guests are saved but left out of stats and the name list', async () => {
  await saveSoloMatch('玩家 1', 1000);

  expect(await listRecentMatches()).toHaveLength(1);
  expect(await statsOf('玩家 1')).toBeUndefined();
  expect(await listKnownPlayerNames()).not.toContain('玩家 1');
});

test('player detail: X01 averages and checkout, cricket MPR, best scores and trend', async () => {
  await saveSampleMatch(1000);
  await saveSampleMatch(2000);
  await saveCompletedMatch({
    mode: 'cricket',
    modeLabel: 'Standard',
    createdAt: 3000,
    players: [{ id: 'player-1', name: 'Alice' }],
    winnerIds: ['player-1'],
    rounds: [
      // 3 + 0 + 2 marks, then 1 mark.
      { playerId: 'player-1', roundIndex: 1, throws: [T20, S1, createThrow('innerBull')] },
      { playerId: 'player-1', roundIndex: 2, throws: [createThrow('single', 15)] },
    ],
  });
  const saveHighScore = (createdAt: number, finalScore: number, teamIndex: number | null) =>
    saveCompletedMatch({
      mode: 'highScore',
      modeLabel: '高分赛',
      createdAt,
      players: [{ id: 'player-1', name: 'Alice', teamIndex, finalScore }],
      winnerIds: ['player-1'],
      rounds: [{ playerId: 'player-1', roundIndex: 1, throws: [T20] }],
    });
  await saveHighScore(4000, 200, null);
  await saveHighScore(5000, 150, null);
  await saveHighScore(6000, 300, 0);

  const alice = await statsOf('Alice');
  const detail = await getPlayerDetail(alice!.playerId);
  expect(detail).toMatchObject({ name: 'Alice', matchesPlayed: 6, wins: 6 });
  expect(detail?.modes.map(mode => mode.mode)).toEqual(['highScore', 'game301', 'cricket']);

  const game301 = detail?.modes.find(mode => mode.mode === 'game301');
  expect(game301?.x01).toMatchObject({
    count60: 0,
    count100: 2,
    count140: 0,
    count180: 2,
    bestCheckout: 121,
    // The D20 with 40 left, once per match.
    checkoutAttempts: 2,
    checkoutHits: 2,
    // Alice won both against Bob, which are not team matches.
    dartsPerLeg: { best: 6, average: 6 },
  });
  expect(game301?.x01?.average).toBeCloseTo(150.5);
  expect(game301?.x01?.first9Average).toBeCloseTo(150.5);
  expect(game301?.bestScore).toBeNull();
  expect(game301?.matches[0].average).toBeCloseTo(150.5);
  // Both matches were on the same day, which makes one point.
  expect(game301?.trend).toHaveLength(1);
  expect(game301?.trend[0].value).toBeCloseTo(150.5);
  expect(game301?.segments).toContainEqual({ target: '20', multiplier: 3, count: 8 });

  const cricket = detail?.modes.find(mode => mode.mode === 'cricket');
  expect(cricket?.cricket?.mpr).toBeCloseTo(3);
  expect(cricket?.cricket?.first9Mpr).toBeCloseTo(3);
  expect(cricket?.cricket?.markRounds).toEqual([1, 0, 0, 0, 0]);
  expect(cricket?.trend.map(point => point.value)).toEqual([3]);

  const highScore = detail?.modes.find(mode => mode.mode === 'highScore');
  // The team match is left out of the best and average score and the trend.
  expect(highScore).toMatchObject({
    matchesPlayed: 3,
    bestScore: 200,
    averageScore: 175,
    rounds: { average: 60, best: 60 },
  });
  expect(highScore?.matches.map(match => [match.createdAt, match.score])).toEqual([
    [6000, null],
    [5000, 150],
    [4000, 200],
  ]);
  expect(highScore?.trend.map(point => point.value)).toEqual([175]);
  expect(highScore?.x01).toBeNull();
  expect(detail?.segments).toContainEqual({ target: '20', multiplier: 3, count: 12 });

  // Bob lost every X01 match, so he has no checkout.
  const bob = await getPlayerDetail((await statsOf('Bob'))!.playerId);
  expect(bob?.modes[0].x01).toMatchObject({ average: 3, bestCheckout: null, dartsPerLeg: null });
  expect(await getPlayerDetail(9999)).toBeNull();
});

test('checkout attempts follow the shared team score and undo a bust', async () => {
  const S = (sector: number) => createThrow('single', sector);
  await saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt: 1000,
    players: [
      { id: 'ann', name: 'Ann', teamIndex: 0 },
      { id: 'ben', name: 'Ben', teamIndex: 0 },
      { id: 'cat', name: 'Cat', teamIndex: 1 },
    ],
    winnerIds: ['ann', 'ben'],
    rounds: [
      { playerId: 'ann', roundIndex: 1, throws: [T20, T20, T20] }, // 121 left
      { playerId: 'cat', roundIndex: 1, throws: [S1, S1, S1] },
      { playerId: 'ben', roundIndex: 1, throws: [T20, S(20), S1] }, // 40 left
      { playerId: 'cat', roundIndex: 2, throws: [S1, S1, S1] },
      // Three darts at a finish (40, 20, 10 left), then zero on a single: bust, back to 40.
      { playerId: 'ann', roundIndex: 2, throws: [S(20), createThrow('double', 5), S(10)] },
      { playerId: 'cat', roundIndex: 3, throws: [S1, S1, S1] },
      { playerId: 'ben', roundIndex: 2, throws: [D20] },
    ],
  });

  const ann = await getPlayerDetail((await statsOf('Ann'))!.playerId);
  expect(ann?.modes[0].x01).toMatchObject({ checkoutAttempts: 3, checkoutHits: 0 });
  const ben = await getPlayerDetail((await statsOf('Ben'))!.playerId);
  expect(ben?.modes[0].x01).toMatchObject({
    checkoutAttempts: 1,
    checkoutHits: 1,
    bestCheckout: 40,
    // A team win is not a leg of their own.
    dartsPerLeg: null,
  });
  expect(ben?.segments).toEqual(
    expect.arrayContaining([
      { target: '20', multiplier: 3, count: 1 },
      { target: '20', multiplier: 1, count: 1 },
      { target: '1', multiplier: 1, count: 1 },
      { target: '20', multiplier: 2, count: 1 },
    ]),
  );
});

test('mode stats: 99 Darts and Around the clock', async () => {
  const S = (sector: number) => createThrow('single', sector);
  const MISS = createThrow('miss');
  await saveCompletedMatch({
    mode: 'darts99',
    modeLabel: '99 Darts at 20',
    createdAt: 1000,
    players: [{ id: 'player-1', name: 'Alice', finalScore: 80 }],
    winnerIds: ['player-1'],
    rounds: [
      { playerId: 'player-1', roundIndex: 1, throws: [S(20), T20] },
      { playerId: 'player-1', roundIndex: 2, throws: [S(5), MISS] },
    ],
  });
  // 1 to 20 and a bull in order, with some misses first.
  const saveClock = (createdAt: number, misses: number) =>
    saveCompletedMatch({
      mode: 'aroundTheClock',
      modeLabel: 'Around the clock',
      createdAt,
      players: [{ id: 'player-1', name: 'Alice' }],
      winnerIds: ['player-1'],
      rounds: [
        {
          playerId: 'player-1',
          roundIndex: 1,
          throws: [
            ...Array(misses).fill(MISS),
            ...Array.from({ length: 20 }, (_, index) => S(index + 1)),
            createThrow('outerBull'),
          ],
        },
      ],
    });
  await saveClock(2000, 0);
  await saveClock(DAY + 3000, 2);

  const detail = await getPlayerDetail((await statsOf('Alice'))!.playerId);
  expect(detail?.modes.find(mode => mode.mode === 'darts99')).toMatchObject({
    bestScore: 80,
    darts99: { hitRate: 0.5, tripleRate: 0.25, doubleRate: 0 },
  });
  const clock = detail?.modes.find(mode => mode.mode === 'aroundTheClock');
  expect(clock?.aroundTheClock?.dartsToFinish).toEqual({ best: 21, average: 22 });
  expect(clock?.aroundTheClock?.hitRate).toBeCloseTo(42 / 44);
  expect(clock?.trend.map(point => point.value)).toEqual([21, 23]);
});

test('mode stats: Shanghai, Half it and Catch 40', async () => {
  const S = (sector: number) => createThrow('single', sector);
  const D = (sector: number) => createThrow('double', sector);
  const T = (sector: number) => createThrow('triple', sector);
  const MISS = createThrow('miss');
  await saveCompletedMatch({
    mode: 'shanghai',
    modeLabel: 'Shanghai',
    createdAt: 1000,
    players: [{ id: 'player-1', name: 'Alice', finalScore: 13 }],
    winnerIds: ['player-1'],
    rounds: [
      { playerId: 'player-1', roundIndex: 1, throws: [S1, S(5), MISS] },
      // Single, double and triple of 2: a Shanghai.
      { playerId: 'player-1', roundIndex: 2, throws: [S(2), D(2), T(2)] },
    ],
  });
  await saveCompletedMatch({
    mode: 'halfIt',
    modeLabel: 'Half it',
    createdAt: 2000,
    players: [{ id: 'player-1', name: 'Alice', finalScore: 35 }],
    winnerIds: ['player-1'],
    rounds: [
      { playerId: 'player-1', roundIndex: 1, throws: [S(15), MISS, MISS] },
      { playerId: 'player-1', roundIndex: 2, throws: [MISS, MISS, MISS] }, // halved
      // Round 3 wants any double; the inner bull counts.
      { playerId: 'player-1', roundIndex: 3, throws: [createThrow('innerBull'), S(3), S(3)] },
    ],
  });
  await saveCompletedMatch({
    mode: 'catch40',
    modeLabel: 'Catch 40',
    createdAt: 3000,
    players: [{ id: 'player-1', name: 'Alice', finalScore: 3 }],
    winnerIds: ['player-1'],
    rounds: [
      // 61: T7, D20 with two darts.
      { playerId: 'player-1', roundIndex: 1, throws: [T(7), D20] },
      // 62: two visits without a finish, then it moves on.
      { playerId: 'player-1', roundIndex: 2, throws: [MISS, MISS, MISS] },
      { playerId: 'player-1', roundIndex: 3, throws: [MISS, MISS, MISS] },
      // 63: only one visit so far.
      { playerId: 'player-1', roundIndex: 4, throws: [S(3), MISS, MISS] },
    ],
  });

  const detail = await getPlayerDetail((await statsOf('Alice'))!.playerId);
  const shanghai = detail?.modes.find(mode => mode.mode === 'shanghai');
  expect(shanghai?.targetRounds).toEqual({ hitRate: 4 / 6, shanghais: 1, halvedPerMatch: 0 });
  const halfIt = detail?.modes.find(mode => mode.mode === 'halfIt');
  expect(halfIt?.targetRounds).toEqual({ hitRate: 2 / 9, shanghais: 0, halvedPerMatch: 1 });
  const catch40 = detail?.modes.find(mode => mode.mode === 'catch40');
  expect(catch40?.checkoutDrill).toEqual({ finished: 1, attempted: 2, averageDarts: 2 });
  expect(catch40?.trend.map(point => point.value)).toEqual([3]);
});

test('a backup restores every match, and importing it again adds nothing', async () => {
  const firstId = await saveSampleMatch(1000);
  await saveCompletedMatch({
    mode: 'highScore',
    modeLabel: '高分赛',
    createdAt: 2000,
    players: [
      { id: 'player-1', name: 'Carol', teamIndex: 0, finalScore: 60 },
      { id: 'player-2', name: 'Bob', teamIndex: 1, finalScore: 3 },
    ],
    winnerIds: ['player-1'],
    rounds: [
      { playerId: 'player-1', roundIndex: 1, throws: [T20] },
      { playerId: 'player-2', roundIndex: 1, throws: [S1, S1, S1] },
    ],
  });
  await deletePlayer((await statsOf('Carol'))!.playerId);
  const before = {
    matches: await listRecentMatches(),
    stats: await listPlayerStats(),
    detail: await getMatchDetail(firstId as number),
  };
  const backup = await exportHistory(5000);

  await clearHistory();
  expect(await importHistory(backup)).toEqual({ status: 'imported', added: 2, skipped: 0 });
  const recent = await listRecentMatches();
  expect(recent.map(({ id: _id, ...match }) => match)).toEqual(
    before.matches.map(({ id: _id, ...match }) => match),
  );
  expect((await listPlayerStats()).map(({ playerId: _playerId, ...stats }) => stats)).toEqual(
    before.stats.map(({ playerId: _playerId, ...stats }) => stats),
  );
  const detail = await getMatchDetail(recent.find(match => match.createdAt === 1000)!.id);
  expect(detail?.rounds.map(round => round.throws)).toEqual(
    before.detail?.rounds.map(round => round.throws),
  );
  // Carol stays deleted (hidden), Bob keeps his team match.
  expect(await listKnownPlayerNames()).not.toContain('Carol');

  expect(await importHistory(backup)).toEqual({ status: 'imported', added: 0, skipped: 2 });
  expect(await listRecentMatches()).toHaveLength(2);
});

test('importing merges with the phone: players join by name, local matches stay', async () => {
  await saveSampleMatch(1000);
  const backup = await exportHistory();
  await clearHistory();
  await saveSoloMatch('Alice', 3000);

  expect(await importHistory(backup)).toEqual({ status: 'imported', added: 1, skipped: 0 });
  expect(await statsOf('Alice')).toMatchObject({ matchesPlayed: 2, wins: 2 });
  expect(await statsOf('Bob')).toMatchObject({ matchesPlayed: 1 });
});

test('the trend has one point per day, and since leaves out older matches', async () => {
  await saveSoloMatch('Alice', 1000);
  await saveSoloMatch('Alice', 2000);
  await saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt: 3 * DAY,
    players: [{ id: 'player-1', name: 'Alice' }],
    winnerIds: ['player-1'],
    rounds: [{ playerId: 'player-1', roundIndex: 1, throws: [S1, S1, S1] }],
  });
  const playerId = (await statsOf('Alice'))!.playerId;

  const all = await getPlayerDetail(playerId);
  expect(all?.modes[0].trend.map(point => point.value)).toEqual([180, 3]);
  expect(all!.modes[0].trend[1].day - all!.modes[0].trend[0].day).toBe(3 * DAY);

  const recent = await getPlayerDetail(playerId, 2 * DAY);
  expect(recent).toMatchObject({ matchesPlayed: 1, wins: 1 });
  expect(recent?.modes[0].trend.map(point => point.value)).toEqual([3]);
  expect(recent?.segments).toEqual([{ target: '1', multiplier: 1, count: 3 }]);

  expect((await getPlayerDetail(playerId, 4 * DAY))?.modes).toEqual([]);
});

test('opponent records leave out teammates and guests, and count third-party wins as played', async () => {
  // Alice beats Bob.
  await saveSampleMatch(1000);
  // Carol wins a three-player match against Alice and Bob.
  await saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt: 2000,
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
      { id: 'c', name: 'Carol' },
      { id: 'g', name: '玩家 4' },
    ],
    winnerIds: ['c'],
    rounds: [],
  });
  // Alice and Bob together beat Carol.
  await saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt: 3000,
    players: [
      { id: 'a', name: 'Alice', teamIndex: 0 },
      { id: 'b', name: 'Bob', teamIndex: 0 },
      { id: 'c', name: 'Carol', teamIndex: 1 },
    ],
    winnerIds: ['a', 'b'],
    rounds: [],
  });

  const alice = await getPlayerDetail((await statsOf('Alice'))!.playerId);
  expect(alice?.opponents.map(({ playerId: _id, ...record }) => record)).toEqual([
    { name: 'Bob', played: 2, wins: 1, losses: 0 },
    { name: 'Carol', played: 2, wins: 1, losses: 1 },
  ]);
  const recent = await getPlayerDetail((await statsOf('Alice'))!.playerId, 2500);
  expect(recent?.opponents.map(record => record.name)).toEqual(['Carol']);
});

test('head to head keeps only the matches the two played against each other', async () => {
  // Alice beats Bob, then Carol wins a match against both, then Alice and Bob team up.
  await saveSampleMatch(1000);
  await saveCompletedMatch({
    mode: 'game301',
    modeLabel: '301',
    createdAt: 2000,
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
      { id: 'c', name: 'Carol' },
    ],
    winnerIds: ['c'],
    rounds: [{ playerId: 'b', roundIndex: 1, throws: [T20, T20, T20] }],
  });
  await saveCompletedMatch({
    mode: 'cricket',
    modeLabel: 'Cricket',
    createdAt: 3000,
    players: [
      { id: 'a', name: 'Alice', teamIndex: 0 },
      { id: 'b', name: 'Bob', teamIndex: 0 },
      { id: 'c', name: 'Carol', teamIndex: 1 },
    ],
    winnerIds: ['a', 'b'],
    rounds: [],
  });
  await saveSoloMatch('Bob', 4000);
  const alice = (await statsOf('Alice'))!.playerId;
  const bob = (await statsOf('Bob'))!.playerId;

  const record = await getHeadToHead(alice, bob);
  expect(record?.results.map(result => result.winner)).toEqual(['other', 'left']);
  expect(record?.left).toMatchObject({ matchesPlayed: 2, wins: 1 });
  expect(record?.right).toMatchObject({ matchesPlayed: 2, wins: 0 });
  expect(record?.left.modes.map(mode => mode.mode)).toEqual(['game301']);
  expect(record?.left.modes[0].x01?.average).toBeCloseTo(150.5);
  expect(record?.right.modes[0].x01?.average).toBeCloseTo(91.5);

  expect((await getHeadToHead(alice, bob, 1500))?.results.map(result => result.winner)).toEqual([
    'other',
  ]);
});

test('only detected hits keep a landing point, and a backup carries them', async () => {
  const detected = throwAt({ x: 0.03, y: -0.52 });
  await saveCompletedMatch({
    mode: 'highScore',
    modeLabel: '高分赛',
    createdAt: 1000,
    players: [{ id: 'player-1', name: 'Alice', finalScore: 60 }],
    winnerIds: ['player-1'],
    rounds: [
      {
        playerId: 'player-1',
        roundIndex: 1,
        throws: [
          detected,
          { ...throwAt({ x: 0, y: -0.53 }), placedByHand: true },
          { ...throwAt({ x: 0.5, y: 0.5 }), needsCheck: true },
        ],
      },
      { playerId: 'player-1', roundIndex: 2, throws: [throwAt({ x: 1.05, y: 0 })] },
    ],
  });
  const expected = [{ x: 0.03, y: -0.52 }];
  const playerId = (await statsOf('Alice'))!.playerId;
  expect((await getPlayerDetail(playerId))?.points).toEqual(expected);
  expect((await getPlayerDetail(playerId))?.modes[0].points).toEqual(expected);

  const backup = await exportHistory();
  await clearHistory();
  await importHistory(backup);
  expect((await getPlayerDetail((await statsOf('Alice'))!.playerId))?.points).toEqual(expected);
});

test('a file that is not a backup is refused without changes', async () => {
  await saveSampleMatch(1000);
  expect(await importHistory('not json')).toEqual({ status: 'invalid' });
  expect(await importHistory('{"app":"Other","matches":[]}')).toEqual({ status: 'invalid' });
  expect(await listRecentMatches()).toHaveLength(1);
});
