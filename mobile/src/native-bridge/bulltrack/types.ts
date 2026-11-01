import type { CameraLockPhase, GameType, ThrowResult } from '../../domain/game/types';
import type { DebugArtifact, PrepBoardDetection } from '../../domain/vision/types';

export interface CameraReadyState {
  isReady: boolean;
  isPreviewBound: boolean;
  zoomRatio: number;
  statusMessage: string;
  lockPhase: CameraLockPhase;
  lockReason?: string | null;
}

// Known once the Game screen has prepared the camera.
export interface BackCameraInfo {
  hasBackCamera: boolean;
  maxZoomRatio: number;
}

export interface StartLiveRoundInput {
  gameMode: GameType;
  playerId: string;
  // Native debug images cost CPU and storage, so they follow the "show debug info" setting.
  debugImages: boolean;
  // Developer recording mode: keep the round's raw frames for offline replay.
  recordFrames: boolean;
  // Developer switch: run YOLO on the CPU instead of the GPU.
  yoloOnCpu: boolean;
  // The player's board is a soft-tip (red-blue) one, which widens the scoring rings.
  softBoard: boolean;
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
  // False when the round is only released; a recorded round then gets no confirmed result.
  confirmed?: boolean;
  // The player's corrected darts, stored with a recorded round.
  editedThrows?: ThrowResult[] | null;
}

export interface FinishRoundResult {
  roundId: string;
  status: 'finished';
  statusMessage: string;
  throws: ThrowResult[];
  debugArtifacts: DebugArtifact[];
}

// A round that still has debug images (and its log) saved; only the newest few are kept.
export interface DebugRoundSummary {
  roundId: string;
  // Epoch milliseconds of the round's last saved file.
  savedAt: number;
  imageCount: number;
}

// A new dart in a double, triple or the bull has its own cue; others use 'dart'.
export type SoundCue =
  | 'ready'
  | 'dart'
  | 'error'
  | 'double'
  | 'triple'
  | 'outerBull'
  | 'innerBull';

export interface BullTrackNativeBridge {
  prepareRoundCamera(): Promise<CameraReadyState & BackCameraInfo>;
  startLiveRound(input: StartLiveRoundInput): Promise<StartLiveRoundResult>;
  stopLiveRound(): Promise<ActionAcceptedResult>;
  redetectCurrentRound(input: RedetectCurrentRoundInput): Promise<ActionAcceptedResult>;
  finishRound(input: FinishRoundInput): Promise<FinishRoundResult>;
  loadDebugArtifacts(roundId: string): Promise<DebugArtifact[]>;
  listDebugRounds(): Promise<DebugRoundSummary[]>;
  // Zips the round's debug images, log and app/device info and opens the share sheet;
  // resolves with the bundle's file name.
  shareDebugRound(roundId: string): Promise<string>;
  // Writes the text to a cache file and opens the share sheet; resolves with the file name.
  shareTextFile(fileName: string, content: string): Promise<string>;
  // Lets the user pick a file and resolves with its text; '' when they cancel.
  pickTextFile(): Promise<string>;
  setZoomRatio(zoomRatio: number): Promise<CameraReadyState>;
  detectPrepBoard(yoloOnCpu: boolean): Promise<PrepBoardDetection>;
  preloadSoundCues(): void;
  playSoundCue(cue: SoundCue): void;
  hapticTick(): void;
}
