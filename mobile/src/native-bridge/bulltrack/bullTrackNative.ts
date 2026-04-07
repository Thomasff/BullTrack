import NativeBullTrackModule from './specs/NativeBullTrackModule';
import { mockBullTrackNativeBridge } from './mockBullTrackNative';
import type {
  ActionAcceptedResult,
  BullTrackNativeBridge,
  CameraReadyState,
  FinishRoundInput,
  FinishRoundResult,
  PreviewDiagnostics,
  RedetectCurrentRoundInput,
  StartLiveRoundInput,
  StartLiveRoundResult,
} from './types';

export const bullTrackNativeModule = NativeBullTrackModule;

const nativeBridge: BullTrackNativeBridge | null = bullTrackNativeModule
  ? {
      prepareRoundCamera: async () =>
        bullTrackNativeModule.prepareRoundCamera() as Promise<CameraReadyState>,
      startLiveRound: async (input: StartLiveRoundInput) =>
        bullTrackNativeModule.startLiveRound(input) as Promise<StartLiveRoundResult>,
      stopLiveRound: async () =>
        bullTrackNativeModule.stopLiveRound() as Promise<ActionAcceptedResult>,
      redetectCurrentRound: async (input: RedetectCurrentRoundInput) =>
        bullTrackNativeModule.redetectCurrentRound(input) as Promise<ActionAcceptedResult>,
      finishRound: async (input: FinishRoundInput) =>
        bullTrackNativeModule.finishRound(input) as Promise<FinishRoundResult>,
      loadDebugArtifacts: async (roundId: string) =>
        bullTrackNativeModule.loadDebugArtifacts(roundId) as Promise<any>,
      setZoomRatio: async (zoomRatio: number) =>
        bullTrackNativeModule.setZoomRatio(zoomRatio) as Promise<CameraReadyState>,
      getPreviewDiagnostics: async () =>
        bullTrackNativeModule.getPreviewDiagnostics() as Promise<PreviewDiagnostics>,
    }
  : null;

export const bullTrackNativeBridge = nativeBridge ?? mockBullTrackNativeBridge;

export const isRealBullTrackNativeBridgeAvailable = nativeBridge !== null;
