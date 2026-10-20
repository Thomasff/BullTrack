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
  bullTrackNativeBridge: {
    preloadSoundCues: () => undefined,
    playSoundCue: (cue: string) => mockPlayedCues.push(cue),
  },
}));
const mockPlayedCues: string[] = [];

import {
  ensureBullTrackSubscriptions,
  resetLiveGameSession,
  startGameSession,
} from '../src/application/services/liveRoundService';
import { useGameStore } from '../src/application/stores/gameStore';
import { useVisionDebugStore } from '../src/application/stores/visionDebugStore';

const darts = [createThrow('single', 4), createThrow('double', 4), createThrow('miss')];

const emit = (name: string, payload: object) => mockListeners[name](payload);

beforeEach(() => {
  resetLiveGameSession();
  ensureBullTrackSubscriptions();
  startGameSession('game301', ['Alice'], '301');
  mockPlayedCues.length = 0;
});

test('sound cues: ready, each new live dart, and a failed live round', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusMessage: '' });
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusMessage: '' });
  emit('onThrowsUpdated', { roundId: 'r1', throws: [], statusMessage: '', canRedetect: false });
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts.slice(0, 1), statusMessage: '', canRedetect: false });
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts.slice(0, 1), statusMessage: '', canRedetect: false });
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts.slice(0, 2), statusMessage: '', canRedetect: false });
  // Manual end fills misses: the final result is not a new dart.
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts, statusMessage: '', canRedetect: true });
  expect(mockPlayedCues).toEqual(['ready', 'dart', 'dart']);

  mockPlayedCues.length = 0;
  emit('onRoundStateChanged', { roundId: 'r2', phase: 'starting', statusMessage: '' });
  emit('onNativeError', { message: '首帧未检测到 board' });
  expect(mockPlayedCues).toEqual(['error']);
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
  emit('onNativeError', { message: '首帧未检测到 board' });
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'finished', statusMessage: '', throws: [] });

  const state = useGameStore.getState();
  expect(state.status).toBe('waitingForThrow');
  expect(state.currentThrows).toEqual([]);
  expect(state.errorMessage).toBe('没看到完整的靶盘，请把手机对准飞镖盘后重试');
  expect(useVisionDebugStore.getState().lastNativeError).toBe('首帧未检测到 board');
});

test('a failed redetect keeps the round confirmable', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusMessage: '', throws: darts, canRedetect: true });
  emit('onNativeError', { message: 'redetect failed' });

  const state = useGameStore.getState();
  expect(state.status).toBe('showingResult');
  expect(state.currentThrows).toHaveLength(3);
  expect(state.errorMessage).toBe('识别出错了，请重试');
});

test('live frames show only while a round is running', () => {
  const { useLiveFrameStore } = require('../src/application/stores/liveFrameStore');
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusMessage: '' });
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusMessage: '' });
  emit('onLiveFrame', { roundId: 'r1', uri: 'file:///frame_1.jpg' });
  expect(useLiveFrameStore.getState().uri).toBe('file:///frame_1.jpg');

  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusMessage: '', throws: darts, canRedetect: true });
  emit('onLiveFrame', { roundId: 'r1', uri: 'file:///frame_2.jpg' });
  expect(useLiveFrameStore.getState().uri).toBe('file:///frame_1.jpg');

  emit('onRoundStateChanged', { roundId: 'r2', phase: 'starting', statusMessage: '' });
  expect(useLiveFrameStore.getState().uri).toBeNull();
});
