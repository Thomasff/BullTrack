import type { CameraLockPhase, GameType, ThrowResult } from '../../domain/game/types';
import type { DebugArtifact, PrepBoardDetection } from '../../domain/vision/types';

export interface CameraReadyState {
  isReady: boolean;
  isPreviewBound: boolean;
  zoomRatio: number;
  // A native.camera code (optionally 'code: detail'), or a native.errors code in the error state.
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

// Share photo files of a round as file URIs; full is missing when there is no photo.
export interface RoundPhotoFiles {
  full?: string;
  close?: string;
}

// Native status text is a code (a key under native.status) with its parameters; RN translates it.
export type NativeStatusParams = Record<string, string | number>;

export interface RoundStateChangedEvent {
  roundId?: string | null;
  phase: 'starting' | 'capturing' | 'showingResult' | 'finished';
  statusCode: string;
  statusParams?: NativeStatusParams;
  throws?: ThrowResult[];
  canRedetect?: boolean;
  // Only on 'capturing'.
  startDartCount?: number;
  leftRightHalfRatio?: number;
  boardHeightShare?: number;
}

export interface ThrowsUpdatedEvent {
  roundId: string;
  throws: ThrowResult[];
  statusCode: string;
  statusParams?: NativeStatusParams;
  canRedetect: boolean;
}

// message is a native error code (see native.errors), optionally with ': detail', or raw text.
export interface NativeErrorEvent {
  code?: string;
  message: string;
}

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
  shareDebugRound(roundId: string, title: string): Promise<string>;
  // Removes every saved debug image, round log and recorded frame.
  deleteDebugFiles(): Promise<boolean>;
  // Writes the text to a cache file and opens the share sheet; resolves with the file name.
  shareTextFile(fileName: string, content: string, title: string): Promise<string>;
  // Lets the user pick a file and resolves with its text; '' when they cancel.
  pickTextFile(): Promise<string>;
  // Shares a captured image file under the given name, with an optional caption ('' for none);
  // resolves with the shared file name.
  shareImage(uri: string, fileName: string, text: string, title: string): Promise<string>;
  // Saves a captured image to Pictures/BullTrack (Android 10+); resolves with the file name.
  saveImageToGallery(uri: string, fileName: string): Promise<string>;
  // Writes the share photos of the round on screen (the live result, else the last confirmed
  // round): 'current' to the cache (only the newest kept), 'highlight' to the app's files as
  // <name>-full.jpg / <name>-close.jpg.
  saveRoundPhotos(target: 'current' | 'highlight', name: string): Promise<RoundPhotoFiles>;
  // The kept highlight photo files.
  listRoundPhotos(): Promise<{ directory: string; names: string[] }>;
  // Resolves with the number of files removed.
  deleteRoundPhotos(names: string[]): Promise<number>;
  setZoomRatio(zoomRatio: number): Promise<CameraReadyState>;
  detectPrepBoard(yoloOnCpu: boolean): Promise<PrepBoardDetection>;
  preloadSoundCues(): void;
  playSoundCue(cue: SoundCue): void;
  hapticTick(): void;
}
