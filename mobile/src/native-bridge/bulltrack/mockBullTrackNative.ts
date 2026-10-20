import type { DebugArtifact } from '../../domain/vision/types';
import type { ThrowResult } from '../../domain/game/types';
import type {
  ActionAcceptedResult,
  BullTrackNativeBridge,
  CameraReadyState,
  FinishRoundInput,
  FinishRoundResult,
  RedetectCurrentRoundInput,
  StartLiveRoundInput,
  StartLiveRoundResult,
} from './types';

const mockThrows: ThrowResult[] = [
  {
    id: 'mock-1',
    label: 'T20',
    score: 60,
    ring: 'triple',
    pointNorm: { x: 0.18, y: -0.42 },
  },
  {
    id: 'mock-2',
    label: 'D16',
    score: 32,
    ring: 'double',
    pointNorm: { x: -0.55, y: 0.3 },
  },
];

const mockArtifacts: DebugArtifact[] = [
  {
    id: 'mock-round:rectified',
    roundId: 'mock-round',
    kind: 'boardRectifiedPreview',
    title: 'Mock Rectified Board',
    path: 'file:///mock/rectified.jpg',
    note: 'Mock fallback artifact.',
  },
];

const readyState: CameraReadyState = {
  isReady: true,
  isPreviewBound: true,
  zoomRatio: 1,
  statusMessage: 'Mock camera ready',
  lockPhase: 'IDLE',
  lockReason: null,
};

const accepted = (statusMessage: string): ActionAcceptedResult => ({
  accepted: true,
  statusMessage,
});

export const mockBullTrackNativeBridge: BullTrackNativeBridge = {
  prepareRoundCamera: async () => readyState,
  startLiveRound: async (_input: StartLiveRoundInput): Promise<StartLiveRoundResult> => ({
    accepted: true,
    statusMessage: 'Mock live round started.',
  }),
  stopLiveRound: async () => accepted('Mock round stopped.'),
  redetectCurrentRound: async (_input: RedetectCurrentRoundInput) =>
    accepted('Mock redetect accepted.'),
  finishRound: async (input: FinishRoundInput): Promise<FinishRoundResult> => ({
    roundId: input.roundId,
    status: 'finished',
    statusMessage: 'Mock round finished.',
    throws: mockThrows,
    debugArtifacts: mockArtifacts,
  }),
  loadDebugArtifacts: async () => mockArtifacts,
  setZoomRatio: async () => readyState,
  preloadSoundCues: () => undefined,
  playSoundCue: () => undefined,
};
