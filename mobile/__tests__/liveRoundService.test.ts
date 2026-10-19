import { createThrow } from '../src/domain/game/throws';
import type { ThrowResult } from '../src/domain/game/types';

jest.mock('react-native-vision-camera', () => ({ Camera: {} }));

const mockSaveCompletedMatch = jest.fn(async (_input: unknown) => undefined);
jest.mock('../src/application/services/historyRepository', () => ({
  saveCompletedMatch: (input: unknown) => mockSaveCompletedMatch(input),
}));

let mockNextThrows: ThrowResult[] = [];
jest.mock('../src/native-bridge/bulltrack/bullTrackNative', () => ({
  bullTrackNativeModule: null,
  isRealBullTrackNativeBridgeAvailable: false,
  bullTrackNativeBridge: {
    finishRound: async ({ roundId }: { roundId: string }) => ({
      roundId,
      status: 'finished',
      statusMessage: 'done',
      throws: mockNextThrows,
      debugArtifacts: [],
    }),
  },
}));

import {
  confirmCurrentRound,
  resetLiveGameSession,
  startGameSession,
} from '../src/application/services/liveRoundService';
import { useGameStore } from '../src/application/stores/gameStore';

const playRound = async (throws: ThrowResult[]) => {
  mockNextThrows = throws;
  useGameStore.setState({ roundId: 'round-test' });
  await confirmCurrentRound();
};

beforeEach(() => {
  mockSaveCompletedMatch.mockClear();
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
    winnerId: string;
    rounds: Array<{ roundIndex: number }>;
    players: Array<{ name: string }>;
  };
  expect(saved.winnerId).toBe('player-1');
  expect(saved.players[0].name).toBe('Alice');
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
  expect(useGameStore.getState().throwsEdited).toBe(false);
});

test('scoreboard starts from the engine initial state', () => {
  startGameSession('game501', ['Alice', 'Bob'], '501');
  expect(useGameStore.getState().scoreBoard?.players.map(player => player.score)).toEqual([501, 501]);
});
