import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  startRound(request: Object): Promise<Object>;
  processFrame(request: Object): Promise<Object>;
  redetectRound(request: Object): Promise<Object>;
  finishRound(request: Object): Promise<Object>;
  loadDebugArtifacts(roundId: string): Promise<Array<Object>>;
}

export default TurboModuleRegistry.get<Spec>('BullTrackModule');
