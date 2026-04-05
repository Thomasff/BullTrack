import { mockBullTrackNativeBridge } from '../../native-bridge/bulltrack/mockBullTrackNative';
import { useGameStore } from '../stores/gameStore';
import { useRoundStore } from '../stores/roundStore';
import { useVisionDebugStore } from '../stores/visionDebugStore';

export const runMockRoundScenario = async () => {
  const gameStore = useGameStore.getState();
  const roundStore = useRoundStore.getState();

  roundStore.setCapturing('Starting mock round via placeholder native bridge...');

  const startResult = await mockBullTrackNativeBridge.startRound({
    gameMode: gameStore.selectedMode,
    playerIds: gameStore.players.map(player => player.id),
  });

  roundStore.setReady(startResult.roundId, startResult.statusMessage);
  roundStore.setCapturing('Processing mock frame pipeline...');

  const processResult = await mockBullTrackNativeBridge.processFrame({
    roundId: startResult.roundId,
    frameSource: 'cameraPreview',
  });

  roundStore.setResult(
    processResult.roundId,
    processResult.statusMessage,
    processResult.throws,
  );
  useVisionDebugStore.getState().setArtifacts(processResult.debugArtifacts);
};

export const rerunMockRedetect = async () => {
  const roundStore = useRoundStore.getState();

  if (!roundStore.roundId) {
    roundStore.setError('Cannot redetect before a mock round is started.');
    return;
  }

  roundStore.setCapturing('Running mock redetect for the current round...');
  const result = await mockBullTrackNativeBridge.redetectRound({
    roundId: roundStore.roundId,
  });
  roundStore.setResult(result.roundId, result.statusMessage, result.throws);
  useVisionDebugStore.getState().setArtifacts(result.debugArtifacts);
};

export const resetMockRoundScenario = () => {
  useRoundStore.getState().reset();
  useVisionDebugStore.getState().clearArtifacts();
  useGameStore.getState().resetDemo();
};
