import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  prepareRoundCamera(): Promise<Object>;
  startLiveRound(request: Object): Promise<Object>;
  stopLiveRound(): Promise<Object>;
  redetectCurrentRound(request: Object): Promise<Object>;
  finishRound(request: Object): Promise<Object>;
  loadDebugArtifacts(roundId: string): Promise<Array<Object>>;
  setZoomRatio(zoomRatio: number): Promise<Object>;
  getPreviewDiagnostics(): Promise<Object>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('BullTrackModule');
