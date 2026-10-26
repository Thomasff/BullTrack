import {
  NativeEventEmitter,
  type EmitterSubscription,
} from 'react-native';
import { Camera } from 'react-native-vision-camera';
import {
  bullTrackNativeBridge,
  bullTrackNativeModule,
} from '../../native-bridge/bulltrack/bullTrackNative';
import { getCurrentThrowerId, useGameStore } from '../stores/gameStore';
import { useVisionDebugStore } from '../stores/visionDebugStore';
import { useLiveFrameStore } from '../stores/liveFrameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { createGameEngine, getGameEngine, resetGameEngine } from './gameRules';
import { deleteMatch, saveCompletedMatch } from './historyRepository';
import { toFriendlyErrorText } from './nativeErrorText';
import { getEngineSides } from '../../domain/game/teams';
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

// Doubles, triples and the bull have their own cue. Darts confirmed together play only the
// highest-scoring one's cue, so cues never run into each other.
const cueForNewThrows = (newThrows: ThrowResult[]): SoundCue => {
  const best = newThrows.reduce((top, item) => (item.score > top.score ? item : top));
  switch (best.ring) {
    case 'double':
    case 'triple':
    case 'outerBull':
    case 'innerBull':
      return best.ring;
    default:
      return 'dart';
  }
};

// The algorithm expects the phone front-left of the board, shooting at an angle: dart tails
// then stick out to the right, where the search area has room. Ratios near 1 are a front view.
const LEFT_SIDE_MIN_RATIO = 1.04;
const RIGHT_SIDE_MAX_RATIO = 0.96;

// What the first frame says about the setup; the round runs either way. leftRightHalfRatio is
// the board's left half over its right half in the image (0 when unknown).
export const describeBoardSetup = (
  startDartCount: number,
  leftRightHalfRatio: number,
): string | null => {
  const hints: string[] = [];
  if (startDartCount > 0) {
    hints.push(`开局时靶上还有 ${startDartCount} 支镖，识别可能不准，下次请先拔镖再开始`);
  }
  if (leftRightHalfRatio > 0 && leftRightHalfRatio <= RIGHT_SIDE_MAX_RATIO) {
    hints.push('手机好像在靶的右侧，飞镖可能识别不全，建议放到靶的左前方斜拍');
  } else if (leftRightHalfRatio > 0 && leftRightHalfRatio < LEFT_SIDE_MIN_RATIO) {
    hints.push('手机几乎正对靶盘，建议放到靶的左前方斜拍，识别更稳');
  }
  return hints.length > 0 ? hints.join('；') : null;
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
        // Only on 'capturing'.
        startDartCount?: number;
        leftRightHalfRatio?: number;
      };

      if (event.phase === 'starting') {
        useLiveFrameStore.getState().clear();
        useGameStore.setState({ setupHint: null });
      }
      if (event.phase === 'capturing') {
        playSoundCue('ready');
        useGameStore.setState({
          setupHint: describeBoardSetup(event.startDartCount ?? 0, event.leftRightHalfRatio ?? 0),
        });
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
        playSoundCue(cueForNewThrows(event.throws.slice(previous.currentThrows.length)));
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

// teamIndexes (one per name) starts a team game; omit it for everyone playing alone.
export const startGameSession = (
  mode: GameType,
  playerNames: string[],
  modeLabel: string,
  teamIndexes?: number[],
) => {
  useGameStore.getState().selectMode(mode, modeLabel);
  useGameStore.getState().configurePlayers(playerNames, teamIndexes);
  const { players, teams } = useGameStore.getState();
  const gameSeed = Math.floor(Math.random() * 0x7fffffff);
  useGameStore.setState({ gameSeed });
  const engine = createGameEngine(mode, getEngineSides(players, teams), gameSeed);
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
    debugImages: useSettingsStore.getState().showDebugInfo,
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
  if (!state.roundId && !state.reopenedRound) {
    throw new Error('No round result to confirm.');
  }
  const roundIndex = state.currentRoundNumber;
  // Darts are recorded under the person who threw them, also in a team game.
  const throwerId = getCurrentThrowerId(state) ?? state.currentPlayerId;
  // Manual corrections made in the UI take precedence over native detection.
  const editedThrows = state.throwsEdited ? state.currentThrows : null;

  let throws = state.currentThrows;
  if (state.roundId) {
    const finishResult = await bullTrackNativeBridge.finishRound({
      roundId: state.roundId,
    });
    useVisionDebugStore.getState().setArtifacts(finishResult.debugArtifacts);
    throws = editedThrows ?? finishResult.throws;
  }
  const appliedRound = applyRoundResult(throws);
  if (!appliedRound) {
    return;
  }

  const completedRound = {
    playerId: throwerId ?? appliedRound.result.playerId,
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
      const savedMatchId = await saveCompletedMatch({
        mode,
        modeLabel: latestState.selectedModeLabel,
        createdAt: latestState.gameStartedAt ?? Date.now(),
        players: latestState.players.map(player => ({
          id: player.id,
          name: player.name,
          teamIndex: player.teamIndex ?? null,
        })),
        // A winning team wins for every member.
        winnerIds: appliedRound.winnerId
          ? latestState.teams?.find(team => team.id === appliedRound.winnerId)?.memberIds ?? [
              appliedRound.winnerId,
            ]
          : [],
        rounds: latestState.completedRounds,
      });
      useGameStore.setState({ errorMessage: null, savedMatchId });
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

// Takes back the last confirmed round (also after the game ended) and shows its darts
// again for correction. Engines are deterministic, so replaying the earlier rounds into
// a fresh engine restores the exact state before that round for every game mode.
export const undoLastRound = async () => {
  const state = useGameStore.getState();
  const lastRound = state.completedRounds[state.completedRounds.length - 1];
  if (
    !lastRound ||
    !state.selectedMode ||
    (state.status !== 'waitingForThrow' && state.status !== 'gameOver')
  ) {
    return;
  }
  if (state.savedMatchId !== null) {
    await deleteMatch(state.savedMatchId);
  }

  const remainingRounds = state.completedRounds.slice(0, -1);
  const engine = createGameEngine(
    state.selectedMode,
    getEngineSides(state.players, state.teams),
    state.gameSeed,
  );
  remainingRounds.forEach(round => engine.applyRound(round.throws));

  useGameStore.setState({
    scoreBoard: engine.getScoreBoard(),
    currentPlayerId: engine.getCurrentPlayerId(),
    currentRoundNumber: engine.getCurrentRoundNumber(),
    completedRounds: remainingRounds,
    winnerId: null,
    savedMatchId: null,
    roundId: null,
    status: 'showingResult',
    statusMessage: '已撤销上一轮，可修改后重新确认',
    currentThrows: lastRound.throws,
    currentThrowNumber: lastRound.throws.length,
    currentRoundResult: null,
    canRedetect: false,
    throwsEdited: false,
    reopenedRound: true,
    errorMessage: null,
  });
};

// Drops a reopened round so the same player throws it again.
export const discardReopenedRound = () => {
  if (useGameStore.getState().reopenedRound) {
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
