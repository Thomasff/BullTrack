import type { ThrowResult } from '../../domain/game/types';
import type { DebugArtifact } from '../../domain/vision/types';

export interface StartRoundInput {
  gameMode: 'highScore' | 'x01' | 'cricket';
  frameRef: string;
  roundId?: string;
}

export interface StartRoundResult {
  roundId: string;
  status: 'ready';
  statusMessage: string;
  debugArtifacts: DebugArtifact[];
}

export interface ProcessFrameInput {
  roundId: string;
  frameRef: string;
}

export interface ProcessFrameResult {
  roundId: string;
  status: 'resultReady';
  statusMessage: string;
  gateTriggered: boolean;
  gateReason: string;
  newThrow: ThrowResult | null;
  throws: ThrowResult[];
  debugArtifacts: DebugArtifact[];
}

export interface RedetectRoundInput {
  roundId: string;
  frameRef: string;
}

export interface RedetectRoundResult {
  roundId: string;
  status: 'resultReady';
  statusMessage: string;
  yoloStatus?: string | null;
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
  throws: ThrowResult[];
}

export interface BullTrackNativeBridge {
  startRound(input: StartRoundInput): Promise<StartRoundResult>;
  processFrame(input: ProcessFrameInput): Promise<ProcessFrameResult>;
  redetectRound(input: RedetectRoundInput): Promise<RedetectRoundResult>;
  finishRound(input: FinishRoundInput): Promise<FinishRoundResult>;
  loadDebugArtifacts(roundId: string): Promise<DebugArtifact[]>;
}
