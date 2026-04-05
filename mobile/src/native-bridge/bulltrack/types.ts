import type { ThrowResult } from '../../domain/game/types';
import type { DebugArtifact } from '../../domain/vision/types';

export interface StartRoundInput {
  gameMode: 'highScore' | 'x01' | 'cricket';
  playerIds: string[];
}

export interface StartRoundResult {
  roundId: string;
  status: 'ready' | 'error';
  statusMessage: string;
}

export interface ProcessFrameInput {
  roundId: string;
  frameSource: 'cameraPreview';
}

export interface ProcessFrameResult {
  roundId: string;
  status: 'capturing' | 'resultReady' | 'error';
  statusMessage: string;
  throws: ThrowResult[];
  debugArtifacts: DebugArtifact[];
}

export interface RedetectRoundInput {
  roundId: string;
}

export interface RedetectRoundResult {
  roundId: string;
  status: 'resultReady' | 'error';
  statusMessage: string;
  throws: ThrowResult[];
  debugArtifacts: DebugArtifact[];
}

export interface FinishRoundInput {
  roundId: string;
}

export interface FinishRoundResult {
  roundId: string;
  status: 'finished';
  statusMessage: string;
}

export interface BullTrackNativeBridge {
  startRound(input: StartRoundInput): Promise<StartRoundResult>;
  processFrame(input: ProcessFrameInput): Promise<ProcessFrameResult>;
  redetectRound(input: RedetectRoundInput): Promise<RedetectRoundResult>;
  finishRound(input: FinishRoundInput): Promise<FinishRoundResult>;
  loadDebugArtifacts(roundId: string): Promise<DebugArtifact[]>;
}
