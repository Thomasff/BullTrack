import type { CameraLockPhase, GameType, ThrowResult } from '../../domain/game/types';
import type { DebugArtifact } from '../../domain/vision/types';

export interface CameraReadyState {
  isReady: boolean;
  isPreviewBound: boolean;
  zoomRatio: number;
  statusMessage: string;
  lockPhase: CameraLockPhase;
  lockReason?: string | null;
}

export interface PreviewDiagnostics {
  createViewManagersCount: number;
  createViewInstanceCount: number;
  viewAttachedCount: number;
  hostAttachFragmentCount: number;
  fragmentCreateViewCount: number;
  fragmentViewCreatedCount: number;
  fragmentStartCount: number;
  controllerAttachPreviewCount: number;
  lastStep: string;
}

export interface StartLiveRoundInput {
  gameMode: GameType;
  playerId: string;
}

export interface StartLiveRoundResult {
  accepted: boolean;
  statusMessage: string;
}

export interface RedetectCurrentRoundInput {
  roundId: string;
}

export interface ActionAcceptedResult {
  accepted: boolean;
  statusMessage: string;
}

export interface FinishRoundInput {
  roundId: string;
}

export interface FinishRoundResult {
  roundId: string;
  status: 'finished';
  statusMessage: string;
  throws: ThrowResult[];
  debugArtifacts: DebugArtifact[];
}

export interface BullTrackNativeBridge {
  prepareRoundCamera(): Promise<CameraReadyState>;
  startLiveRound(input: StartLiveRoundInput): Promise<StartLiveRoundResult>;
  stopLiveRound(): Promise<ActionAcceptedResult>;
  redetectCurrentRound(input: RedetectCurrentRoundInput): Promise<ActionAcceptedResult>;
  finishRound(input: FinishRoundInput): Promise<FinishRoundResult>;
  loadDebugArtifacts(roundId: string): Promise<DebugArtifact[]>;
  setZoomRatio(zoomRatio: number): Promise<CameraReadyState>;
  getPreviewDiagnostics(): Promise<PreviewDiagnostics>;
}
