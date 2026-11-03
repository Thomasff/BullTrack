import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  prepareRoundCamera(): Promise<Object>;
  startLiveRound(request: Object): Promise<Object>;
  stopLiveRound(): Promise<Object>;
  redetectCurrentRound(request: Object): Promise<Object>;
  finishRound(request: Object): Promise<Object>;
  loadDebugArtifacts(roundId: string): Promise<Array<Object>>;
  listDebugRounds(): Promise<Array<Object>>;
  shareDebugRound(roundId: string, title: string): Promise<string>;
  deleteDebugFiles(): Promise<boolean>;
  shareTextFile(fileName: string, content: string, title: string): Promise<string>;
  pickTextFile(): Promise<string>;
  shareImage(uri: string, fileName: string, text: string, title: string): Promise<string>;
  saveImageToGallery(uri: string, fileName: string): Promise<string>;
  saveRoundPhotos(target: string, name: string): Promise<Object>;
  listRoundPhotos(): Promise<Object>;
  deleteRoundPhotos(names: Array<string>): Promise<number>;
  setZoomRatio(zoomRatio: number): Promise<Object>;
  detectPrepBoard(yoloOnCpu: boolean): Promise<Object>;
  preloadSoundCues(): void;
  playSoundCue(cue: string): void;
  hapticTick(): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('BullTrackModule');
