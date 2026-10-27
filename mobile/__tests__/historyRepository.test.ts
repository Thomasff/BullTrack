import { createThrow } from '../src/domain/game/throws';

jest.mock('react-native-sqlite-storage', () => require('../jest/sqliteNodeAdapter'));

import {
  clearHistory,
  deleteMatch,
  deletePlayer,
  getMatchDetail,
  getSetting,
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
