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
  shareDebugRound(roundId: string): Promise<string>;
  setZoomRatio(zoomRatio: number): Promise<Object>;
  preloadSoundCues(): void;
  playSoundCue(cue: string): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('BullTrackModule');
