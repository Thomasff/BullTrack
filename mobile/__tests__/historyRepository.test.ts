import { createThrow } from '../src/domain/game/throws';

jest.mock('react-native-sqlite-storage', () => require('../jest/sqliteNodeAdapter'));

import {
  clearHistory,
  deleteMatch,
  deletePlayer,
  exportHistory,
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
  expect(detail?.x01).toMatchObject({
    count60: 0,
    count100: 2,
    count140: 0,
    count180: 2,
    bestCheckout: 121,
    // The D20 with 40 left, once per match.
    checkoutAttempts: 2,
    checkoutHits: 2,
  });
  expect(detail?.x01?.average).toBeCloseTo(150.5);
  expect(detail?.x01?.first9Average).toBeCloseTo(150.5);
  expect(detail?.cricketMpr).toBeCloseTo(3);
  const highScore = detail?.modes.find(mode => mode.mode === 'highScore');
  // The team match is left out of the best and average score.
  expect(highScore).toMatchObject({ matchesPlayed: 3, bestScore: 200, averageScore: 175 });
  expect(highScore?.matches.map(match => [match.createdAt, match.score])).toEqual([
    [6000, null],
    [5000, 150],
    [4000, 200],
  ]);
  const game301 = detail?.modes.find(mode => mode.mode === 'game301');
  expect(game301).toMatchObject({ bestScore: null, x01: { checkoutAttempts: 2 } });
  expect(game301?.matches[0].average).toBeCloseTo(150.5);
  expect(detail?.modes.find(mode => mode.mode === 'cricket')?.mpr).toBeCloseTo(3);
  expect(detail?.x01Trend.map(point => point.createdAt)).toEqual([1000, 2000]);
  expect(detail?.segments).toContainEqual({ target: '20', multiplier: 3, count: 12 });

  // Bob lost every X01 match, so he has no checkout.
  const bob = await getPlayerDetail((await statsOf('Bob'))!.playerId);
  expect(bob?.x01).toMatchObject({ average: 3, bestCheckout: null });
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
  expect(ann?.x01).toMatchObject({ checkoutAttempts: 3, checkoutHits: 0 });
  const ben = await getPlayerDetail((await statsOf('Ben'))!.playerId);
  expect(ben?.x01).toMatchObject({ checkoutAttempts: 1, checkoutHits: 1, bestCheckout: 40 });
  expect(ben?.segments).toEqual(
    expect.arrayContaining([
      { target: '20', multiplier: 3, count: 1 },
      { target: '20', multiplier: 1, count: 1 },
      { target: '1', multiplier: 1, count: 1 },
      { target: '20', multiplier: 2, count: 1 },
    ]),
  );
});

test('mode stats: 99 Darts hit rate and Around the clock darts to finish', async () => {
  const S = (sector: number) => createThrow('single', sector);
  await saveCompletedMatch({
    mode: 'darts99',
    modeLabel: '99 Darts at 20',
    createdAt: 1000,
    players: [{ id: 'player-1', name: 'Alice', finalScore: 80 }],
    winnerIds: ['player-1'],
    rounds: [
      { playerId: 'player-1', roundIndex: 1, throws: [S(20), T20] },
      { playerId: 'player-1', roundIndex: 2, throws: [S(5), createThrow('miss')] },
    ],
  });
  const saveClock = (createdAt: number, darts: number) =>
    saveCompletedMatch({
      mode: 'aroundTheClock',
      modeLabel: 'Around the clock',
      createdAt,
      players: [{ id: 'player-1', name: 'Alice' }],
      winnerIds: ['player-1'],
      rounds: [{ playerId: 'player-1', roundIndex: 1, throws: Array(darts).fill(S1) }],
    });
  await saveClock(2000, 5);
  await saveClock(3000, 7);

  const detail = await getPlayerDetail((await statsOf('Alice'))!.playerId);
  expect(detail?.modes.find(mode => mode.mode === 'darts99')).toMatchObject({
    hitRate: 0.5,
    bestScore: 80,
  });
  expect(detail?.modes.find(mode => mode.mode === 'aroundTheClock')?.dartsToFinish).toEqual({
    best: 5,
    average: 6,
  });
  expect(detail?.x01).toBeNull();
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

test('a file that is not a backup is refused without changes', async () => {
  await saveSampleMatch(1000);
  expect(await importHistory('not json')).toEqual({ status: 'invalid' });
  expect(await importHistory('{"app":"Other","matches":[]}')).toEqual({ status: 'invalid' });
  expect(await listRecentMatches()).toHaveLength(1);
});
