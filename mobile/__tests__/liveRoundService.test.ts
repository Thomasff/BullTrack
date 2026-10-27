import { createThrow } from '../src/domain/game/throws';
import type { ThrowResult } from '../src/domain/game/types';

jest.mock('react-native-vision-camera', () => ({ Camera: {} }));

const mockSaveCompletedMatch = jest.fn(async (_input: unknown) => 42);
const mockDeleteMatch = jest.fn(async (_matchId: number) => undefined);
jest.mock('../src/application/services/historyRepository', () => ({
  saveCompletedMatch: (input: unknown) => mockSaveCompletedMatch(input),
  deleteMatch: (matchId: number) => mockDeleteMatch(matchId),
}));

let mockNextThrows: ThrowResult[] = [];
const mockFinishInputs: unknown[] = [];
jest.mock('../src/native-bridge/bulltrack/bullTrackNative', () => ({
  bullTrackNativeModule: null,
  isRealBullTrackNativeBridgeAvailable: false,
  bullTrackNativeBridge: {
    finishRound: async (input: { roundId: string }) => {
      mockFinishInputs.push(input);
      return {
        roundId: input.roundId,
        status: 'finished',
        statusMessage: 'done',
        throws: mockNextThrows,
        debugArtifacts: [],
      };
    },
  },
}));

import {
  confirmCurrentRound,
  discardReopenedRound,
  resetLiveGameSession,
  startGameSession,
  undoLastRound,
} from '../src/application/services/liveRoundService';
import { useGameStore } from '../src/application/stores/gameStore';

const playRound = async (throws: ThrowResult[]) => {
  mockNextThrows = throws;
  useGameStore.setState({ roundId: 'round-test' });
  await confirmCurrentRound();
};

beforeEach(() => {
  mockSaveCompletedMatch.mockClear();
  mockDeleteMatch.mockClear();
  resetLiveGameSession();
});

test('saves the match to history when the game ends', async () => {
  startGameSession('game301', ['Alice'], '301');
  const T20 = createThrow('triple', 20);
  await playRound([T20, T20, T20]); // 121 left
  expect(mockSaveCompletedMatch).not.toHaveBeenCalled();
  await playRound([T20, createThrow('triple', 7), createThrow('double', 20)]);

  expect(useGameStore.getState().status).toBe('gameOver');
  expect(mockSaveCompletedMatch).toHaveBeenCalledTimes(1);
  const saved = mockSaveCompletedMatch.mock.calls[0][0] as {
    winnerIds: string[];
    rounds: Array<{ roundIndex: number }>;
    players: Array<{ name: string; finalScore: number | null }>;
  };
  expect(saved.winnerIds).toEqual(['player-1']);
  expect(saved.players[0].name).toBe('Alice');
  expect(saved.players[0].finalScore).toBe(0);
  expect(saved.rounds.map(round => round.roundIndex)).toEqual([1, 2]);
});

test('manually edited throws override native detection on confirm', async () => {
  startGameSession('game301', ['Alice'], '301');
  mockNextThrows = [createThrow('single', 1), createThrow('single', 1), createThrow('single', 1)];
  useGameStore.setState({ roundId: 'round-test', currentThrows: mockNextThrows });
  useGameStore.getState().replaceThrow(0, createThrow('triple', 20));
  await confirmCurrentRound();

  const board = useGameStore.getState().scoreBoard;
  expect(board?.players[0].score).toBe(301 - 62);
  // A recorded round stores what the player confirmed.
  const finishInput = mockFinishInputs[mockFinishInputs.length - 1] as {
    confirmed: boolean;
    editedThrows: ThrowResult[];
  };
  expect(finishInput.confirmed).toBe(true);
  expect(finishInput.editedThrows.map(dart => dart.label)).toEqual(['T20', 'S1', 'S1']);
  expect(useGameStore.getState().throwsEdited).toBe(false);
});

test('scoreboard starts from the engine initial state', () => {
  startGameSession('game501', ['Alice', 'Bob'], '501');
  expect(useGameStore.getState().scoreBoard?.players.map(player => player.score)).toEqual([501, 501]);
});

const S1 = createThrow('single', 1);
const T20 = createThrow('triple', 20);

test('undo reopens the last round for correction and re-applies it', async () => {
  startGameSession('game301', ['Alice', 'Bob'], '301');
  await playRound([T20, T20, T20]);
  await playRound([S1, S1, S1]);

  await undoLastRound();
  let state = useGameStore.getState();
  expect(state.status).toBe('showingResult');
  expect(state.reopenedRound).toBe(true);
  expect(state.currentPlayerId).toBe('player-2');
  expect(state.currentRoundNumber).toBe(1);
  expect(state.currentThrows).toEqual([S1, S1, S1]);
  expect(state.completedRounds).toHaveLength(1);
  expect(state.scoreBoard?.players.map(player => player.score)).toEqual([121, 301]);

  // Confirming a reopened round needs no native session.
  useGameStore.setState({ roundId: null });
  state.replaceThrow(0, T20);
  await confirmCurrentRound();
  state = useGameStore.getState();
  expect(state.scoreBoard?.players.map(player => player.score)).toEqual([121, 301 - 62]);
  expect(state.completedRounds.map(round => [round.playerId, round.roundIndex])).toEqual([
    ['player-1', 1],
    ['player-2', 1],
  ]);
  expect(state.currentPlayerId).toBe('player-1');
  expect(state.currentRoundNumber).toBe(2);
  expect(state.reopenedRound).toBe(false);
});

test('undoing the winning round removes the saved match', async () => {
  startGameSession('game301', ['Alice'], '301');
  await playRound([T20, T20, T20]);
  await playRound([T20, createThrow('triple', 7), createThrow('double', 20)]);
  expect(useGameStore.getState().savedMatchId).toBe(42);

  await undoLastRound();
  const state = useGameStore.getState();
  expect(mockDeleteMatch).toHaveBeenCalledWith(42);
  expect(state.status).toBe('showingResult');
  expect(state.winnerId).toBeNull();
  expect(state.savedMatchId).toBeNull();
  expect(state.scoreBoard?.players[0].score).toBe(121);

  // Re-confirming the same darts finishes and saves the game again.
  await confirmCurrentRound();
  expect(useGameStore.getState().status).toBe('gameOver');
  expect(mockSaveCompletedMatch).toHaveBeenCalledTimes(2);
});

test('undo restores cricket marks by replaying earlier rounds', async () => {
  startGameSession('cricket', ['Alice', 'Bob'], 'Cricket');
  await playRound([T20, T20, S1]);
  await undoLastRound();
  const alice = useGameStore.getState().scoreBoard?.players[0];
  expect(alice?.marks?.['20']).toBe(0);
  expect(alice?.score).toBe(0);
});

test('undo keeps the Killer numbers dealt at the start of the game', async () => {
  startGameSession('killer', ['Alice', 'Bob', 'Carol'], 'Killer');
  const numbers = () =>
    useGameStore.getState().scoreBoard?.players.map(player => player.killer?.number);
  const dealt = numbers();
  await playRound([S1, S1, S1]);
  await playRound([S1, S1, S1]);
  await undoLastRound();
  expect(numbers()).toEqual(dealt);
});

test('rethrowing a reopened round goes back to waiting for the same player', async () => {
  startGameSession('game301', ['Alice', 'Bob'], '301');
  await playRound([T20, T20, T20]);
  await undoLastRound();
  discardReopenedRound();
  const state = useGameStore.getState();
  expect(state.status).toBe('waitingForThrow');
  expect(state.currentPlayerId).toBe('player-1');
  expect(state.currentThrows).toEqual([]);
  expect(state.reopenedRound).toBe(false);
});

test('team game: shared score, alternating teams, darts recorded per thrower', async () => {
  // A 队: Alice + Bob, B 队: Carol (uneven teams).
  startGameSession('game301', ['Alice', 'Bob', 'Carol'], '301', [0, 0, 1]);
  const state = () => useGameStore.getState();
  expect(state().scoreBoard?.players.map(side => side.name)).toEqual(['A 队', 'B 队']);

  await playRound([T20, T20, T20]); // Alice: A 队 121 left
  await playRound([S1, S1, S1]); // Carol
  await playRound([S1, S1, S1]); // Bob: A 队 118 left
  await playRound([S1, S1, S1]); // Carol again
  expect(state().completedRounds.map(round => [round.playerId, round.roundIndex])).toEqual([
    ['player-1', 1],
    ['player-3', 1],
    ['player-2', 2],
    ['player-3', 2],
  ]);
  expect(state().scoreBoard?.players.map(side => side.score)).toEqual([118, 295]);
  expect(state().currentPlayerId).toBe('team-1');

  // Alice checks out for the team: both A 队 members win.
  await playRound([T20, createThrow('triple', 6), createThrow('double', 20)]);
  expect(state().status).toBe('gameOver');
  expect(state().winnerId).toBe('team-1');
  const saved = mockSaveCompletedMatch.mock.calls[0][0] as {
    winnerIds: string[];
    players: Array<{ id: string; teamIndex: number | null; finalScore: number | null }>;
    rounds: Array<{ playerId: string }>;
  };
  expect(saved.winnerIds).toEqual(['player-1', 'player-2']);
  expect(saved.players.map(player => player.teamIndex)).toEqual([0, 0, 1]);
  // Each member carries the team's score.
  expect(saved.players.map(player => player.finalScore)).toEqual([
    0,
    0,
    state().scoreBoard?.players[1].score,
  ]);
  expect(saved.rounds[4].playerId).toBe('player-1');

  // Undo brings the round back for the same team and thrower.
  await undoLastRound();
  expect(state().currentPlayerId).toBe('team-1');
  expect(state().scoreBoard?.players[0].score).toBe(118);
  expect(state().completedRounds).toHaveLength(4);
});
