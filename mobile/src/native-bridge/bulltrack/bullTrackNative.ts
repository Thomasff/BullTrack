import NativeBullTrackModule from './specs/NativeBullTrackModule';
import type { PrepBoardDetection } from '../../domain/vision/types';
import { mockBullTrackNativeBridge } from './mockBullTrackNative';
import type {
  ActionAcceptedResult,
  BullTrackNativeBridge,
  BackCameraInfo,
  CameraReadyState,
  DebugRoundSummary,
  FinishRoundInput,
  FinishRoundResult,
  RoundPhotoFiles,
  SoundCue,
  RedetectCurrentRoundInput,
  StartLiveRoundInput,
  StartLiveRoundResult,
} from './types';

export const bullTrackNativeModule = NativeBullTrackModule;

const nativeBridge: BullTrackNativeBridge | null = bullTrackNativeModule
  ? {
      prepareRoundCamera: async () =>
        bullTrackNativeModule.prepareRoundCamera() as Promise<
          CameraReadyState & BackCameraInfo
        >,
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
      listDebugRounds: async () =>
        bullTrackNativeModule.listDebugRounds() as Promise<DebugRoundSummary[]>,
      shareDebugRound: async (roundId: string) => bullTrackNativeModule.shareDebugRound(roundId),
      shareTextFile: async (fileName: string, content: string) =>
        bullTrackNativeModule.shareTextFile(fileName, content),
      pickTextFile: async () => bullTrackNativeModule.pickTextFile(),
      shareImage: async (uri: string, fileName: string, text: string) =>
        bullTrackNativeModule.shareImage(uri, fileName, text),
      saveImageToGallery: async (uri: string, fileName: string) =>
        bullTrackNativeModule.saveImageToGallery(uri, fileName),
      saveRoundPhotos: async (target: 'current' | 'highlight', name: string) =>
        bullTrackNativeModule.saveRoundPhotos(target, name) as Promise<RoundPhotoFiles>,
      listRoundPhotos: async () =>
        bullTrackNativeModule.listRoundPhotos() as Promise<{ directory: string; names: string[] }>,
      deleteRoundPhotos: async (names: string[]) => bullTrackNativeModule.deleteRoundPhotos(names),
      setZoomRatio: async (zoomRatio: number) =>
        bullTrackNativeModule.setZoomRatio(zoomRatio) as Promise<CameraReadyState>,
      detectPrepBoard: async (yoloOnCpu: boolean) =>
        bullTrackNativeModule.detectPrepBoard(yoloOnCpu) as Promise<PrepBoardDetection>,
      preloadSoundCues: () => bullTrackNativeModule.preloadSoundCues(),
      playSoundCue: (cue: SoundCue) => bullTrackNativeModule.playSoundCue(cue),
      hapticTick: () => bullTrackNativeModule.hapticTick(),
    }
  : null;

export const bullTrackNativeBridge = nativeBridge ?? mockBullTrackNativeBridge;

export const isRealBullTrackNativeBridgeAvailable = nativeBridge !== null;
