import type { ThrowResult } from '../../domain/game/types';
import type { DebugArtifact } from '../../domain/vision/types';
import type {
  BullTrackNativeBridge,
  FinishRoundInput,
  FinishRoundResult,
  ProcessFrameInput,
  ProcessFrameResult,
  RedetectRoundInput,
  RedetectRoundResult,
  StartRoundInput,
  StartRoundResult,
} from './types';

const mockRoundId = 'mock-round-001';

const mockThrows: ThrowResult[] = [
  {
    id: 'throw-1',
    label: 'D20',
    score: 40,
    ring: 'double',
    pointNorm: { x: 0.16, y: -0.74 },
  },
  {
    id: 'throw-2',
    label: 'T19',
    score: 57,
    ring: 'triple',
    pointNorm: { x: -0.43, y: -0.18 },
  },
  {
    id: 'throw-3',
    label: 'S17',
    score: 17,
    ring: 'single',
    pointNorm: { x: 0.52, y: 0.25 },
  },
];

const mockArtifacts: DebugArtifact[] = [
  {
    id: 'artifact-1',
    roundId: mockRoundId,
    kind: 'boardRectifiedPreview',
    title: 'Board Rectified Preview',
    path: 'debug/mock/board_rectified_preview.jpg',
    note: '第一阶段占位图路径，后续替换为 Native 文件路径。',
  },
  {
    id: 'artifact-2',
    roundId: mockRoundId,
    kind: 'adaptiveRedSamplePoints',
    title: 'Adaptive Red Sample Points',
    path: 'debug/mock/adaptive_red_sample_points.jpg',
  },
  {
    id: 'artifact-3',
    roundId: mockRoundId,
    kind: 'yoloRedetectOverlay',
    title: 'YOLO Redetect Overlay',
    path: 'debug/mock/yolo_redetect_overlay.jpg',
  },
];

const sleep = async (durationMs: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, durationMs);
  });

export class MockBullTrackNativeBridge implements BullTrackNativeBridge {
  async startRound(_: StartRoundInput): Promise<StartRoundResult> {
    await sleep(180);
    return {
      roundId: mockRoundId,
      status: 'ready',
      statusMessage: 'Mock native bridge ready for round capture.',
    };
  }

  async processFrame(_: ProcessFrameInput): Promise<ProcessFrameResult> {
    await sleep(260);
    return {
      roundId: mockRoundId,
      status: 'resultReady',
      statusMessage: 'Mock detection completed with 3 throws.',
      throws: mockThrows,
      debugArtifacts: mockArtifacts,
    };
  }

  async redetectRound(_: RedetectRoundInput): Promise<RedetectRoundResult> {
    await sleep(220);
    return {
      roundId: mockRoundId,
      status: 'resultReady',
      statusMessage: 'Mock redetect refreshed the current round.',
      throws: mockThrows,
      debugArtifacts: mockArtifacts,
    };
  }

  async finishRound(input: FinishRoundInput): Promise<FinishRoundResult> {
    await sleep(120);
    return {
      roundId: input.roundId,
      status: 'finished',
      statusMessage: 'Mock round finished.',
    };
  }

  async loadDebugArtifacts(roundId: string): Promise<DebugArtifact[]> {
    await sleep(80);
    return mockArtifacts.map(artifact => ({ ...artifact, roundId }));
  }
}

export const mockBullTrackNativeBridge = new MockBullTrackNativeBridge();
