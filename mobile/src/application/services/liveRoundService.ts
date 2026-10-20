import {
  NativeEventEmitter,
  type EmitterSubscription,
} from 'react-native';
import { Camera } from 'react-native-vision-camera';
import {
  bullTrackNativeBridge,
  bullTrackNativeModule,
} from '../../native-bridge/bulltrack/bullTrackNative';
import { useGameStore } from '../stores/gameStore';
import { useVisionDebugStore } from '../stores/visionDebugStore';
import { useLiveFrameStore } from '../stores/liveFrameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { createGameEngine, getGameEngine, resetGameEngine } from './gameRules';
import { saveCompletedMatch } from './historyRepository';
import { toFriendlyErrorText } from './nativeErrorText';
import type { SoundCue } from '../../native-bridge/bulltrack/types';
import type {
  CameraStatus,
  GameType,
  ThrowResult,
} from '../../domain/game/types';

let subscriptions: EmitterSubscription[] = [];
let isSubscribed = false;

const eventEmitter =
  bullTrackNativeModule !== null
    ? new NativeEventEmitter(bullTrackNativeModule)
    : null;

// Cues are for a player standing at the board who cannot watch the screen.
export const playSoundCue = (cue: SoundCue) => {
  if (useSettingsStore.getState().soundCues) {
    bullTrackNativeBridge.playSoundCue(cue);
  }
};

const applyRoundResult = (throws: ThrowResult[]) => {
  const engine = getGameEngine();
  if (!engine) {
    return null;
  }

  const result = engine.applyRound(throws);
  const scoreBoard = engine.getScoreBoard();
  const nextPlayerId = engine.getCurrentPlayerId();
  const winnerId = engine.getWinnerId();
  const isGameOver = engine.isGameOver();

  useGameStore.getState().setScoreBoard(scoreBoard);
  useGameStore.getState().setRoundResult(result);
  useGameStore.setState({ currentRoundNumber: engine.getCurrentRoundNumber() });

  if (isGameOver) {
    useGameStore.getState().setWinner(
      winnerId,
      winnerId
        ? `${scoreBoard.players.find(player => player.id === winnerId)?.name ?? 'Player'} 获胜`
        : '比赛结束',
    );
    return { result, isGameOver, winnerId };
  }

  useGameStore.getState().setCurrentPlayer(nextPlayerId);
  return { result, isGameOver, winnerId };
};

export const ensureBullTrackSubscriptions = () => {
  if (isSubscribed || eventEmitter === null) {
    return;
  }
  bullTrackNativeBridge.preloadSoundCues();

  subscriptions = [
    eventEmitter.addListener('onCameraStatusChanged', payload => {
      useGameStore.getState().setCameraStatus(payload as Partial<CameraStatus>);
    }),
    eventEmitter.addListener('onRoundStateChanged', payload => {
      const event = payload as {
        roundId?: string | null;
        phase: 'starting' | 'capturing' | 'showingResult' | 'finished';
        statusMessage: string;
        throws?: ThrowResult[];
        canRedetect?: boolean;
      };

      if (event.phase === 'starting') {
        useLiveFrameStore.getState().clear();
      }
      if (event.phase === 'capturing') {
        playSoundCue('ready');
      }
      if (event.phase === 'starting' || event.phase === 'capturing') {
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'roundInProgress',
          statusMessage: event.statusMessage,
          currentThrows: event.throws ?? [],
          canRedetect: false,
          errorMessage: null,
          captureReady: event.phase === 'capturing',
        });
      } else if (event.phase === 'showingResult') {
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'showingResult',
          statusMessage: event.statusMessage,
          currentThrows: event.throws ?? [],
          canRedetect: event.canRedetect ?? true,
          errorMessage: null,
        });
      } else {
        // Keep any error from onNativeError visible; drop throws of a failed round.
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'waitingForThrow',
          statusMessage: event.statusMessage,
          currentThrows: event.throws ?? [],
          canRedetect: false,
        });
      }
    }),
    eventEmitter.addListener('onThrowsUpdated', payload => {
      const event = payload as {
        roundId: string;
        throws: ThrowResult[];
        statusMessage: string;
        canRedetect: boolean;
      };
      const previous = useGameStore.getState();
      // Only a dart newly found during live capture, not the final/redetect result.
      if (
        !event.canRedetect &&
        previous.status === 'roundInProgress' &&
        event.throws.length > previous.currentThrows.length
      ) {
        playSoundCue('dart');
      }
      useGameStore.getState().setRoundState({
        roundId: event.roundId,
        status: event.canRedetect ? 'showingResult' : 'roundInProgress',
        statusMessage: event.statusMessage,
        currentThrows: event.throws,
        canRedetect: event.canRedetect,
        errorMessage: null,
      });
    }),
    eventEmitter.addListener('onLiveFrame', payload => {
      const event = payload as { roundId: string; uri: string };
      // Frames encoded after the round ended are stale; ignore them.
      if (useGameStore.getState().status === 'roundInProgress') {
        useLiveFrameStore.getState().setFrame(event.roundId, event.uri);
      }
    }),
    eventEmitter.addListener('onNativeError', payload => {
      const event = payload as {
        message: string;
      };
      // A failed live round (e.g. board not found) leaves the player waiting at the board.
      if (useGameStore.getState().status === 'roundInProgress') {
        playSoundCue('error');
      }
      // Status transitions come from onRoundStateChanged; only surface the error here.
      useVisionDebugStore.getState().setLastNativeError(event.message);
      useGameStore.getState().setRoundState({
        errorMessage: toFriendlyErrorText(event.message),
      });
    }),
  ];
  isSubscribed = true;
};

export const teardownBullTrackSubscriptions = () => {
  subscriptions.forEach(subscription => subscription.remove());
  subscriptions = [];
  isSubscribed = false;
};

export const requestCameraPermission = async (): Promise<boolean> => {
  const currentStatus = await Camera.getCameraPermissionStatus();
  const nextStatus =
    currentStatus === 'granted' ? currentStatus : await Camera.requestCameraPermission();
  const isGranted = nextStatus === 'granted';
  useGameStore.getState().setCameraPermissionGranted(isGranted);
  return isGranted;
};

// Re-reads the permission without prompting, e.g. after returning from system settings.
export const refreshCameraPermission = async (): Promise<boolean> => {
  const isGranted = (await Camera.getCameraPermissionStatus()) === 'granted';
  useGameStore.getState().setCameraPermissionGranted(isGranted);
  return isGranted;
};

export const startGameSession = (
  mode: GameType,
  playerNames: string[],
  modeLabel: string,
) => {
  useGameStore.getState().selectMode(mode, modeLabel);
  useGameStore.getState().configurePlayers(playerNames);
  const players = useGameStore.getState().players;
  const engine = createGameEngine(mode, players);
  useGameStore.getState().setCurrentPlayer(engine.getCurrentPlayerId());
  useGameStore.getState().setScoreBoard(engine.getScoreBoard());
};

export const prepareLiveCamera = async () => {
  ensureBullTrackSubscriptions();
  useGameStore.getState().setCameraStatus({
    isReady: false,
    isPreviewBound: false,
    zoomRatio: useSettingsStore.getState().zoomRatio,
    statusMessage: '预览由 VisionCamera 管理，等待预览初始化',
    lockPhase: 'IDLE',
    lockReason: null,
  });
  await bullTrackNativeBridge.prepareRoundCamera();
};

export const getPreviewDiagnostics = async () => bullTrackNativeBridge.getPreviewDiagnostics();

export const updateLiveZoomRatio = async (zoomRatio: number) => {
  const readyState = await bullTrackNativeBridge.setZoomRatio(zoomRatio);
  useGameStore.getState().setCameraStatus(readyState);
};

export const startLiveRound = async () => {
  const state = useGameStore.getState();
  if (!state.selectedMode || !state.currentPlayerId) {
    throw new Error('Game session has not been configured.');
  }
  await bullTrackNativeBridge.startLiveRound({
    gameMode: state.selectedMode,
    playerId: state.currentPlayerId,
  });
};

export const stopLiveRound = async () => {
  await bullTrackNativeBridge.stopLiveRound();
};

export const redetectCurrentRound = async () => {
  const roundId = useGameStore.getState().roundId;
  if (!roundId) {
    throw new Error('No active round to redetect.');
  }
  await bullTrackNativeBridge.redetectCurrentRound({ roundId });
};

export const confirmCurrentRound = async () => {
  const state = useGameStore.getState();
  if (!state.roundId) {
    throw new Error('No round result to confirm.');
  }
  const roundIndex = state.currentRoundNumber;
  // Manual corrections made in the UI take precedence over native detection.
  const editedThrows = state.throwsEdited ? state.currentThrows : null;

  const finishResult = await bullTrackNativeBridge.finishRound({
    roundId: state.roundId,
  });
  useVisionDebugStore.getState().setArtifacts(finishResult.debugArtifacts);
  const appliedRound = applyRoundResult(editedThrows ?? finishResult.throws);
  if (!appliedRound) {
    return;
  }

  const completedRound = {
    playerId: appliedRound.result.playerId,
    roundIndex,
    throws: appliedRound.result.throws,
  };
  useGameStore.getState().addCompletedRound(completedRound);

  if (appliedRound.isGameOver) {
    const latestState = useGameStore.getState();
    const mode = latestState.selectedMode ?? state.selectedMode;
    try {
      if (!mode) {
        throw new Error('Game mode is missing.');
      }
      await saveCompletedMatch({
        mode,
        modeLabel: latestState.selectedModeLabel,
        createdAt: latestState.gameStartedAt ?? Date.now(),
        players: latestState.players.map(player => ({
          id: player.id,
          name: player.name,
        })),
        winnerId: appliedRound.winnerId,
        rounds: latestState.completedRounds,
      });
      useGameStore.setState({ errorMessage: null });
    } catch (error) {
      useGameStore.setState({
        errorMessage:
          error instanceof Error
            ? `保存历史失败: ${error.message}`
            : '保存历史失败',
      });
    }
    return;
  }

  const engine = getGameEngine();
  if (!engine?.isGameOver()) {
    useGameStore.getState().clearRoundForNextTurn();
  }
};

export const reloadDebugArtifacts = async () => {
  const roundId = useGameStore.getState().roundId;
  if (!roundId) {
    useVisionDebugStore.getState().setArtifacts([]);
    return;
  }
  const artifacts = await bullTrackNativeBridge.loadDebugArtifacts(roundId);
  useVisionDebugStore.getState().setArtifacts(artifacts);
};

export const resetLiveGameSession = () => {
  resetGameEngine();
  useVisionDebugStore.getState().clearArtifacts();
  useGameStore.getState().resetGame();
};

// Releases a native round that is waiting for confirmation, so a later game can start a new one.
export const abandonCurrentRound = async () => {
  const { roundId, status } = useGameStore.getState();
  if (roundId && status === 'showingResult') {
    await bullTrackNativeBridge.finishRound({ roundId }).catch(() => undefined);
  }
};
