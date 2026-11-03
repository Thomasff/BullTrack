import {
  NativeEventEmitter,
  PermissionsAndroid,
  type EmitterSubscription,
} from 'react-native';
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
import { pruneRoundPhotos } from './shareService';
import { isPlacementError, toFriendlyErrorText, toNativeErrorDebugText } from './nativeErrorText';
import { toCameraStatusText, toNativeStatusText } from './nativeStatusText';
import { getEngineSides } from '../../domain/game/teams';
import { t } from '../../i18n';
import type {
  CameraReadyState,
  NativeErrorEvent,
  RoundStateChangedEvent,
  SoundCue,
  ThrowsUpdatedEvent,
} from '../../native-bridge/bulltrack/types';
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

export const playHapticTick = () => {
  if (useSettingsStore.getState().vibration) {
    bullTrackNativeBridge.hapticTick();
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

// The algorithm expects the phone front left or front right of the board, shooting at an angle;
// native finds the side from the ratio. Within this ratio of 1 either way it is close to a front
// view.
const SIDE_VIEW_MIN_RATIO = 1.04;
// Board height over the side of the square the model sees. Native refuses under 0.55 and over
// 0.9 (the training range); up to this share the board is a little small.
const BOARD_SHARE_HINT = 0.6;

const isFrontView = (leftRightHalfRatio: number) =>
  leftRightHalfRatio > 0 &&
  Math.max(leftRightHalfRatio, 1 / leftRightHalfRatio) < SIDE_VIEW_MIN_RATIO;
const isSmallBoard = (boardHeightShare: number) =>
  boardHeightShare > 0 && boardHeightShare < BOARD_SHARE_HINT;

// Whether describeBoardSetup has advice on where the phone stands (not just darts left on the board).
export const boardSetupAboutPlacement = (leftRightHalfRatio: number, boardHeightShare = 0) =>
  isFrontView(leftRightHalfRatio) || isSmallBoard(boardHeightShare);

// What the first frame says about the setup; the round runs either way. leftRightHalfRatio is
// the board's left half over its right half in the image (0 when unknown). The dart count is
// not shown: YOLO sometimes boxes one dart twice. boardHeightShare is 0 when unknown.
export const describeBoardSetup = (
  startDartCount: number,
  leftRightHalfRatio: number,
  boardHeightShare = 0,
): string | null => {
  const hints: string[] = [];
  if (startDartCount > 0) {
    hints.push(t('native.session.dartsLeftHint'));
  }
  if (isFrontView(leftRightHalfRatio)) {
    hints.push(t('native.session.frontViewHint'));
  }
  if (isSmallBoard(boardHeightShare)) {
    hints.push(t('native.session.smallBoardHint'));
  }
  return hints.length > 0 ? hints.join(t('native.session.hintSeparator')) : null;
};

// Camera status from native: the round controller's messages are codes.
const toCameraStatus = (status: Partial<CameraReadyState>): Partial<CameraStatus> => ({
  ...status,
  ...(status.statusMessage !== undefined
    ? { statusMessage: toCameraStatusText(status.statusMessage) }
    : {}),
  ...(status.lockReason ? { lockReason: toCameraStatusText(status.lockReason) } : {}),
});

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
        ? t('native.session.winner', {
            name: scoreBoard.players.find(player => player.id === winnerId)?.name ?? 'Player',
          })
        : t('native.session.gameOver'),
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
      useGameStore.getState().setCameraStatus(toCameraStatus(payload as Partial<CameraReadyState>));
    }),
    eventEmitter.addListener('onRoundStateChanged', payload => {
      const event = payload as RoundStateChangedEvent;
      const statusMessage = toNativeStatusText(event.statusCode, event.statusParams);

      if (event.phase === 'starting') {
        useLiveFrameStore.getState().clear();
        useGameStore.setState({ setupHint: null, setupHintAboutPlacement: false });
      }
      if (event.phase === 'capturing') {
        playSoundCue('ready');
        useGameStore.setState({
          setupHint: describeBoardSetup(
            event.startDartCount ?? 0,
            event.leftRightHalfRatio ?? 0,
            event.boardHeightShare ?? 0,
          ),
          setupHintAboutPlacement: boardSetupAboutPlacement(
            event.leftRightHalfRatio ?? 0,
            event.boardHeightShare ?? 0,
          ),
        });
      }
      if (event.phase === 'starting' || event.phase === 'capturing') {
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'roundInProgress',
          statusMessage,
          currentThrows: event.throws ?? [],
          canRedetect: false,
          errorMessage: null,
          captureReady: event.phase === 'capturing',
        });
      } else if (event.phase === 'showingResult') {
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'showingResult',
          statusMessage,
          currentThrows: event.throws ?? [],
          canRedetect: event.canRedetect ?? true,
          errorMessage: null,
        });
      } else {
        // Keep any error from onNativeError visible; drop throws of a failed round.
        useGameStore.getState().setRoundState({
          roundId: event.roundId ?? null,
          status: 'waitingForThrow',
          statusMessage,
          currentThrows: event.throws ?? [],
          canRedetect: false,
        });
      }
    }),
    eventEmitter.addListener('onThrowsUpdated', payload => {
      const event = payload as ThrowsUpdatedEvent;
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
        statusMessage: toNativeStatusText(event.statusCode, event.statusParams),
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
      const event = payload as NativeErrorEvent;
      // A failed live round (e.g. board not found) leaves the player waiting at the board.
      if (useGameStore.getState().status === 'roundInProgress') {
        playSoundCue('error');
      }
      // Status transitions come from onRoundStateChanged; only surface the error here.
      useVisionDebugStore.getState().setLastNativeError(toNativeErrorDebugText(event.message));
      useGameStore.getState().setRoundState({
        errorMessage: toFriendlyErrorText(event.message),
        errorAboutPlacement: isPlacementError(event.message),
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
  const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
  const isGranted =
    (await PermissionsAndroid.check(permission)) ||
    (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
  useGameStore.getState().setCameraPermissionGranted(isGranted);
  return isGranted;
};

// Re-reads the permission without prompting, e.g. after returning from system settings.
export const refreshCameraPermission = async (): Promise<boolean> => {
  const isGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
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
  // The new game has no photos yet; games left before the end lose theirs here.
  pruneRoundPhotos().catch(() => undefined);
};

export const prepareLiveCamera = async () => {
  ensureBullTrackSubscriptions();
  useGameStore.getState().setCameraStatus({
    isReady: false,
    isPreviewBound: false,
    zoomRatio: useSettingsStore.getState().zoomRatio,
    statusMessage: t('native.session.waitingPreview'),
    lockPhase: 'IDLE',
    lockReason: null,
  });
  const { hasBackCamera, maxZoomRatio } = await bullTrackNativeBridge.prepareRoundCamera();
  useGameStore.setState({ backCamera: { hasBackCamera, maxZoomRatio } });
};

export const updateLiveZoomRatio = async (zoomRatio: number) => {
  const readyState = await bullTrackNativeBridge.setZoomRatio(zoomRatio);
  useGameStore.getState().setCameraStatus(toCameraStatus(readyState));
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
    recordFrames: useSettingsStore.getState().recordFrames,
    yoloOnCpu: useSettingsStore.getState().yoloOnCpu,
    softBoard: useSettingsStore.getState().boardKind === 'soft',
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
      confirmed: true,
      editedThrows,
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
        players: latestState.players.map(player => {
          const sideId =
            latestState.teams?.find(team => team.memberIds.includes(player.id))?.id ?? player.id;
          return {
            id: player.id,
            name: player.name,
            teamIndex: player.teamIndex ?? null,
            finalScore:
              latestState.scoreBoard?.players.find(side => side.id === sideId)?.score ?? null,
          };
        }),
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
            ? t('native.session.saveHistoryFailedDetail', { error: error.message })
            : t('native.session.saveHistoryFailed'),
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
    statusMessage: t('native.session.roundUndone'),
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
