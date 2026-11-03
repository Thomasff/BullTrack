import { createThrow } from '../src/domain/game/throws';

type Listener = (payload: unknown) => void;
const mockListeners: Record<string, Listener> = {};

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(), releaseCapture: jest.fn() }));
jest.mock('react-native', () => ({
  NativeEventEmitter: class {
    addListener(name: string, listener: Listener) {
      mockListeners[name] = listener;
      return { remove: () => undefined };
    }
  },
}));
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
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: '' });
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusCode: '' });
  emit('onThrowsUpdated', { roundId: 'r1', throws: [], statusCode: '', canRedetect: false });
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts.slice(0, 1), statusCode: '', canRedetect: false });
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts.slice(0, 1), statusCode: '', canRedetect: false });
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts.slice(0, 2), statusCode: '', canRedetect: false });
  // Manual end fills misses: the final result is not a new dart.
  emit('onThrowsUpdated', { roundId: 'r1', throws: darts, statusCode: '', canRedetect: true });
  expect(mockPlayedCues).toEqual(['ready', 'dart', 'double']);

  mockPlayedCues.length = 0;
  emit('onRoundStateChanged', { roundId: 'r2', phase: 'starting', statusCode: '' });
  emit('onNativeError', { message: 'board_not_found' });
  expect(mockPlayedCues).toEqual(['error']);
});

test('sound cues: ring cues, and darts confirmed together play the highest-scoring one', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusCode: '' });
  const bull = [createThrow('outerBull'), createThrow('innerBull'), createThrow('triple', 1)];
  emit('onThrowsUpdated', { roundId: 'r1', throws: bull.slice(0, 1), statusCode: '', canRedetect: false });
  emit('onThrowsUpdated', { roundId: 'r1', throws: bull, statusCode: '', canRedetect: false });
  expect(mockPlayedCues).toEqual(['ready', 'outerBull', 'innerBull']);

  mockPlayedCues.length = 0;
  emit('onRoundStateChanged', { roundId: 'r2', phase: 'capturing', statusCode: '' });
  const triple = [createThrow('miss'), createThrow('triple', 20), createThrow('double', 5)];
  emit('onThrowsUpdated', { roundId: 'r2', throws: triple, statusCode: '', canRedetect: false });
  expect(mockPlayedCues).toEqual(['ready', 'triple']);
});

test('setup hint: darts left on the board and phone position, kept until the next round starts', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: '' });
  emit('onRoundStateChanged', {
    roundId: 'r1',
    phase: 'capturing',
    statusCode: '',
    startDartCount: 2,
    leftRightHalfRatio: 1.02,
  });
  expect(useGameStore.getState().setupHint).toBe(
    '开局时靶上还有镖，识别可能不准，下次请先拔镖再开始；手机几乎正对靶盘，建议放到靶的左前方或右前方斜拍，识别更稳',
  );
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusCode: '', throws: darts, canRedetect: true });
  expect(useGameStore.getState().setupHint).not.toBeNull();

  emit('onRoundStateChanged', { roundId: 'r2', phase: 'starting', statusCode: '' });
  expect(useGameStore.getState().setupHint).toBeNull();
  emit('onRoundStateChanged', {
    roundId: 'r2',
    phase: 'capturing',
    statusCode: '',
    startDartCount: 0,
    leftRightHalfRatio: 1.2,
  });
  expect(useGameStore.getState().setupHint).toBeNull();
});

test('setup hint: a front view, and an unknown ratio says nothing about position', () => {
  const { describeBoardSetup } = require('../src/application/services/liveRoundService');
  expect(describeBoardSetup(0, 1.0)).toBe('手机几乎正对靶盘，建议放到靶的左前方或右前方斜拍，识别更稳');
  // Front right is as good as front left; just inside 1.04 the other way is still a front view.
  expect(describeBoardSetup(0, 0.92)).toBeNull();
  expect(describeBoardSetup(0, 0.97)).toBe('手机几乎正对靶盘，建议放到靶的左前方或右前方斜拍，识别更稳');
  expect(describeBoardSetup(0, 0)).toBeNull();
  expect(describeBoardSetup(1, 0)).toBe('开局时靶上还有镖，识别可能不准，下次请先拔镖再开始');
});

test('a round refused for a small board says how to fix it', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: '' });
  emit('onNativeError', { message: 'board too small in frame' });
  expect(mockPlayedCues).toEqual(['error']);
  expect(useGameStore.getState().errorMessage).toBe('画面里的靶子太小，请把手机靠近靶子或放大画面后再开始');
  expect(useGameStore.getState().errorAboutPlacement).toBe(true);
});

test('only errors and hints about the phone or the board link the placement guide', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: '' });
  emit('onNativeError', { message: 'dart_contour_not_found' });
  expect(useGameStore.getState().errorAboutPlacement).toBe(false);
  emit('onNativeError', { message: 'no_red_regions' });
  expect(useGameStore.getState().errorAboutPlacement).toBe(true);
  emit('onRoundStateChanged', { roundId: 'r2', phase: 'starting', statusCode: '' });
  expect(useGameStore.getState().errorAboutPlacement).toBe(false);
  emit('onRoundStateChanged', {
    roundId: 'r2',
    phase: 'capturing',
    statusCode: '',
    startDartCount: 1,
    leftRightHalfRatio: 1.2,
  });
  expect(useGameStore.getState().setupHintAboutPlacement).toBe(false);
  emit('onRoundStateChanged', { roundId: 'r3', phase: 'starting', statusCode: '' });
  emit('onRoundStateChanged', { roundId: 'r3', phase: 'capturing', statusCode: '', leftRightHalfRatio: 1.0 });
  expect(useGameStore.getState().setupHintAboutPlacement).toBe(true);
});

test('capture readiness follows starting -> capturing', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: '' });
  expect(useGameStore.getState().captureReady).toBe(false);
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusCode: '' });
  expect(useGameStore.getState().status).toBe('roundInProgress');
  expect(useGameStore.getState().captureReady).toBe(true);
});

test('a failed live round clears stale darts and keeps the error visible', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusCode: '', throws: darts, canRedetect: true });
  emit('onNativeError', { message: 'board_not_found' });
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'finished', statusCode: '', throws: [] });

  const state = useGameStore.getState();
  expect(state.status).toBe('waitingForThrow');
  expect(state.currentThrows).toEqual([]);
  expect(state.errorMessage).toBe('没看到完整的靶盘，请把手机对准飞镖盘后重试');
  expect(useVisionDebugStore.getState().lastNativeError).toBe('首帧未检测到 board');
});

test('a failed redetect keeps the round confirmable', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusCode: '', throws: darts, canRedetect: true });
  emit('onNativeError', { message: 'redetect failed' });

  const state = useGameStore.getState();
  expect(state.status).toBe('showingResult');
  expect(state.currentThrows).toHaveLength(3);
  expect(state.errorMessage).toBe('识别出错了，请重试');
});

test('live frames show only while a round is running', () => {
  const { useLiveFrameStore } = require('../src/application/stores/liveFrameStore');
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: '' });
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusCode: '' });
  emit('onLiveFrame', { roundId: 'r1', uri: 'file:///frame_1.jpg' });
  expect(useLiveFrameStore.getState().uri).toBe('file:///frame_1.jpg');

  emit('onRoundStateChanged', { roundId: 'r1', phase: 'showingResult', statusCode: '', throws: darts, canRedetect: true });
  emit('onLiveFrame', { roundId: 'r1', uri: 'file:///frame_2.jpg' });
  expect(useLiveFrameStore.getState().uri).toBe('file:///frame_1.jpg');

  emit('onRoundStateChanged', { roundId: 'r2', phase: 'starting', statusCode: '' });
  expect(useLiveFrameStore.getState().uri).toBeNull();
});

test('native status codes are translated, with gate reasons and error codes inside', () => {
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: 'round_starting' });
  expect(useGameStore.getState().statusMessage).toBe('原生相机接管中，准备拍摄首帧');

  emit('onThrowsUpdated', {
    roundId: 'r1',
    throws: [],
    statusCode: 'frame_not_triggered',
    statusParams: { frame: 4, reason: 'alignment_low 0.42' },
    canRedetect: false,
  });
  expect(useGameStore.getState().statusMessage).toBe('第 4 张图片未触发精检: 画面晃动或被遮挡，等下一张');

  emit('onThrowsUpdated', {
    roundId: 'r1',
    throws: [],
    statusCode: 'frame_failed',
    statusParams: { frame: 5, error: 'yolo_input_failed: in0' },
    canRedetect: false,
  });
  expect(useGameStore.getState().statusMessage).toBe('第 5 张图片处理失败: YOLO 输入失败: in0');

  emit('onThrowsUpdated', {
    roundId: 'r1',
    throws: darts.slice(0, 1),
    statusCode: 'frame_new_dart',
    statusParams: { frame: 6, count: 1 },
    canRedetect: false,
  });
  expect(useGameStore.getState().statusMessage).toBe('第 6 张图片识别到新飞镖，当前共 1 支');

  // A code this app version does not know is shown as it is.
  emit('onRoundStateChanged', { roundId: 'r1', phase: 'capturing', statusCode: 'some_new_code' });
  expect(useGameStore.getState().statusMessage).toBe('some_new_code');
});

test('camera status, lock reason and error codes are translated; CameraX text passes through', () => {
  emit('onCameraStatusChanged', { statusMessage: 'camera_not_initialized', lockReason: null });
  expect(useGameStore.getState().cameraStatus.statusMessage).toBe('原生相机未初始化');
  emit('onCameraStatusChanged', { statusMessage: 'round_zoom_locked: 1.50', lockReason: 'af_ae_timeout' });
  expect(useGameStore.getState().cameraStatus.statusMessage).toBe(
    '本轮固定 zoom 1.50x，首帧已完成自动对焦/测光稳定，后续连续拍摄直接快拍',
  );
  expect(useGameStore.getState().cameraStatus.lockReason).toBe('自动对焦/测光等待超时，按当前状态拍摄');
  emit('onCameraStatusChanged', { statusMessage: 'camera_bind_failed', lockReason: 'camera_bind_failed' });
  expect(useGameStore.getState().cameraStatus.statusMessage).toBe('绑定相机失败');
  emit('onCameraStatusChanged', { statusMessage: 'Camera is closed', lockReason: null });
  expect(useGameStore.getState().cameraStatus.statusMessage).toBe('Camera is closed');

  // The first frame's camera note arrives inside a round status.
  emit('onRoundStateChanged', {
    roundId: 'r1',
    phase: 'capturing',
    statusCode: 'camera_message',
    statusParams: { message: 'round_zoom_locked: 2.00' },
  });
  expect(useGameStore.getState().statusMessage).toBe(
    '本轮固定 zoom 2.00x，首帧已完成自动对焦/测光稳定，后续连续拍摄直接快拍',
  );

  emit('onNativeError', { message: 'camera_not_ready' });
  expect(useVisionDebugStore.getState().lastNativeError).toBe('相机尚未就绪');
  expect(useGameStore.getState().errorMessage).toBe('相机暂时不可用，请退出对局后重试');
});

test('native errors follow the app language', async () => {
  const { changeLanguage } = require('../src/i18n');
  await changeLanguage('en');
  try {
    emit('onRoundStateChanged', { roundId: 'r1', phase: 'starting', statusCode: '' });
    emit('onNativeError', { message: 'double_seats_inconsistent: 0.123' });
    expect(useVisionDebugStore.getState().lastNativeError).toBe('Double beds do not line up, residual: 0.123');
    expect(useGameStore.getState().errorMessage).toBe(
      "Can't see the whole board. Point the phone at the dartboard and try again.",
    );
  } finally {
    await changeLanguage('zh');
  }
});
