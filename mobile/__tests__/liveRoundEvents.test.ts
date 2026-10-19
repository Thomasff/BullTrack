import { createThrow } from '../src/domain/game/throws';

type Listener = (payload: unknown) => void;
const mockListeners: Record<string, Listener> = {};

jest.mock('react-native', () => ({
  NativeEventEmitter: class {
    addListener(name: string, listener: Listener) {
      mockListeners[name] = listener;
      return { remove: () => undefined };
    }
  },
}));
jest.mock('react-native-vision-camera', () => ({ Camera: {} }));
jest.mock('../src/application/services/historyRepository', () => ({
  saveCompletedMatch: async () => undefined,
}));
jest.mock('../src/native-bridge/bulltrack/bullTrackNative', () => ({
  bullTrackNativeModule: {},
  isRealBullTrackNativeBridgeAvailable: true,
  bullTrackNativeBridge: {},
}));

import {
  ensureBullTrackSubscriptions,
  resetLiveGameSession,
  startGameSession,
} from '../src/application/services/liveRoundService';
import { useGameStore } from '../src/application/stores/gameStore';

const darts = [createThrow('single', 4), createThrow('double', 4), createThrow('miss')];

const emit = (name: string, payload: object) => mockListeners[name](payload);

beforeEach(() => {
  resetLiveGameSession();
  ensureBullTrackSubscriptions();
  startGameSession('game301', ['Alice'], '301');
});

test('capture readiness follows starting -> capturing', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusMessage: '' });
  expect(useGameStore.getState().captureReady).toBe(false);
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusMessage: '' });
  expect(useGameStore.getState().status).toBe('roundInProgress');
  expect(useGameStore.getState().captureReady).toBe(true);
});

test('a failed live round clears stale darts and keeps the error visible', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusMessage: '', throws: darts, canRedetect: true });
  emit('onNativeError', { message: 'boom' });
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'finished', statusMessage: '', throws: [] });

  const state = useGameStore.getState();
  expect(state.status).toBe('waitingForThrow');
  expect(state.currentThrows).toEqual([]);
  expect(state.errorMessage).toContain('boom');
});

test('a failed redetect keeps the round confirmable', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusMessage: '', throws: darts, canRedetect: true });
  emit('onNativeError', { message: 'redetect failed' });

  const state = useGameStore.getState();
  expect(state.status).toBe('showingResult');
  expect(state.currentThrows).toHaveLength(3);
  expect(state.errorMessage).toContain('redetect failed');
});
