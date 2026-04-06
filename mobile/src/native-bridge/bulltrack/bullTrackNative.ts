import NativeBullTrackModule from './specs/NativeBullTrackModule';
import { mockBullTrackNativeBridge } from './mockBullTrackNative';
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

const nativeModule = NativeBullTrackModule;

const nativeBridge: BullTrackNativeBridge | null = nativeModule
  ? {
      startRound: async (input: StartRoundInput) =>
        nativeModule.startRound(input) as Promise<StartRoundResult>,
      processFrame: async (input: ProcessFrameInput) =>
        nativeModule.processFrame(input) as Promise<ProcessFrameResult>,
      redetectRound: async (input: RedetectRoundInput) =>
        nativeModule.redetectRound(input) as Promise<RedetectRoundResult>,
      finishRound: async (input: FinishRoundInput) =>
        nativeModule.finishRound(input) as Promise<FinishRoundResult>,
      loadDebugArtifacts: async (roundId: string) =>
        nativeModule.loadDebugArtifacts(roundId) as Promise<any>,
    }
  : null;

export const bullTrackNativeBridge = nativeBridge ?? mockBullTrackNativeBridge;

export const isRealBullTrackNativeBridgeAvailable = nativeBridge !== null;
