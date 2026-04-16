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
import { createGameEngine, getGameEngine, resetGameEngine } from './gameRules';
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

const applyRoundResult = (throws: ThrowResult[]) => {
  const engine = getGameEngine();
  if (!engine) {
    return;
  }

  const result = engine.applyRound(throws);
  const scoreBoard = engine.getScoreBoard();
  const nextPlayerId = engine.getCurrentPlayerId();
  const winnerId = engine.getWinnerId();

  useGameStore.getState().setScoreBoard(scoreBoard);
  useGameStore.getState().setRoundResult(result);
  useGameStore.setState({ currentRoundNumber: engine.getCurrentRoundNumber() });

  if (engine.isGameOver()) {
    useGameStore.getState().setWinner(
      winnerId,
      winnerId
        ? `${scoreBoard.players.find(player => player.id === winnerId)?.name ?? 'Player'} 获胜`
        : '比赛结束',
    );
    return;
  }

  useGameStore.getState().setCurrentPlayer(nextPlayerId);
};

export const ensureBullTrackSubscriptions = () => {
  if (isSubscribed || eventEmitter === null) {
    return;
  }

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

      if (event.phase === 'starting' || event.phase === 'capturing') {
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'roundInProgress',
          statusMessage: event.statusMessage,
          currentThrows: event.throws ?? [],
          canRedetect: false,
          errorMessage: null,
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
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'waitingForThrow',
          statusMessage: event.statusMessage,
          canRedetect: false,
          errorMessage: null,
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
      useGameStore.getState().setRoundState({
        roundId: event.roundId,
        status: event.canRedetect ? 'showingResult' : 'roundInProgress',
        statusMessage: event.statusMessage,
        currentThrows: event.throws,
        canRedetect: event.canRedetect,
        errorMessage: null,
      });
    }),
    eventEmitter.addListener('onNativeError', payload => {
      const event = payload as {
        message: string;
      };
      useGameStore.getState().setRoundState({
        status: 'waitingForThrow',
        statusMessage: 'Native round failed',
        errorMessage: event.message,
        canRedetect: false,
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

export const startGameSession = (
  mode: GameType,
  playerNames: string[],
  modeLabel: string,
) => {
  useGameStore.getState().selectMode(mode, modeLabel);
  useGameStore.getState().configurePlayers(playerNames);
  const players = useGameStore.getState().players;
  createGameEngine(mode, players);
  useGameStore.getState().setCurrentPlayer(players[0]?.id ?? null);
  useGameStore.getState().setScoreBoard({ players });
};

export const prepareLiveCamera = async () => {
  ensureBullTrackSubscriptions();
  useGameStore.getState().setCameraStatus({
    isReady: false,
    isPreviewBound: false,
    zoomRatio: 1,
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

  const finishResult = await bullTrackNativeBridge.finishRound({
    roundId: state.roundId,
  });
  useVisionDebugStore.getState().setArtifacts(finishResult.debugArtifacts);
  applyRoundResult(finishResult.throws);

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
