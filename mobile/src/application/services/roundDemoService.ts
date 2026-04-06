import {
  bullTrackNativeBridge,
  isRealBullTrackNativeBridgeAvailable,
} from '../../native-bridge/bulltrack/bullTrackNative';
import { useGameStore } from '../stores/gameStore';
import { useRoundStore } from '../stores/roundStore';
import { useVisionDebugStore } from '../stores/visionDebugStore';

export const CONTROLLED_START_FRAME = 'asset://before.jpg';
export const CONTROLLED_PROCESS_FRAME = 'asset://before.jpg';
export const CONTROLLED_REDETECT_FRAME = 'asset://before.jpg';
const BRIDGE_TIMEOUT_MS = 20000;

const withTimeout = async <T>(work: Promise<T>, step: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${step} timed out after ${BRIDGE_TIMEOUT_MS}ms`));
    }, BRIDGE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const runMockRoundScenario = async () => {
  const gameStore = useGameStore.getState();
  const roundStore = useRoundStore.getState();

  try {
    roundStore.setCapturing(
      isRealBullTrackNativeBridgeAvailable
        ? 'Starting single-frame native detect with before.jpg. Emulator runs are rejected on purpose.'
        : 'Starting fallback mock round because the native bridge is unavailable...',
    );

    const startResult = await withTimeout(
      bullTrackNativeBridge.startRound({
        gameMode: gameStore.selectedMode,
        frameRef: CONTROLLED_START_FRAME,
      }),
      'startRound',
    );

    useVisionDebugStore.getState().setArtifacts(startResult.debugArtifacts);
    roundStore.setResult(
      startResult.roundId,
      `${startResult.statusMessage} (single-frame mode: before.jpg only)`,
      [],
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'startRound failed in single-frame mode';
    roundStore.setError(`Single-frame detect failed: ${message}`);
  }
};

export const rerunMockRedetect = async () => {
  const roundStore = useRoundStore.getState();
  roundStore.setError(
    'Redetect is disabled in single-frame mode. Use Start Controlled Round (before.jpg).',
  );
};

export const finishControlledRound = async () => {
  const roundStore = useRoundStore.getState();

  if (!roundStore.roundId) {
    roundStore.setError('Cannot finish before a controlled round is started.');
    return;
  }

  try {
    const result = await withTimeout(
      bullTrackNativeBridge.finishRound({
        roundId: roundStore.roundId,
      }),
      'finishRound',
    );
    roundStore.setResult(result.roundId, result.statusMessage, result.throws);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'finishRound failed in single-frame mode';
    roundStore.setError(`Finish round failed: ${message}`);
  }
};

export const reloadControlledArtifacts = async () => {
  const roundStore = useRoundStore.getState();

  if (!roundStore.roundId) {
    roundStore.setError('Cannot load debug artifacts before a round exists.');
    return;
  }

  try {
    const artifacts = await withTimeout(
      bullTrackNativeBridge.loadDebugArtifacts(roundStore.roundId),
      'loadDebugArtifacts',
    );
    useVisionDebugStore.getState().setArtifacts(artifacts);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'loadDebugArtifacts failed in single-frame mode';
    roundStore.setError(`Load debug artifacts failed: ${message}`);
  }
};

export const resetMockRoundScenario = () => {
  useRoundStore.getState().reset();
  useVisionDebugStore.getState().clearArtifacts();
  useGameStore.getState().resetDemo();
};
