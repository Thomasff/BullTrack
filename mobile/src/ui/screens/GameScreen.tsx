import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  abandonCurrentRound,
  confirmCurrentRound,
  discardReopenedRound,
  ensureBullTrackSubscriptions,
  prepareLiveCamera,
  redetectCurrentRound,
  refreshCameraPermission,
  reloadDebugArtifacts,
  requestCameraPermission,
  resetLiveGameSession,
  startGameSession,
  startLiveRound,
  stopLiveRound,
  undoLastRound,
  updateLiveZoomRatio,
} from '../../application/services/liveRoundService';
import { getCurrentThrowerId, useGameStore } from '../../application/stores/gameStore';
import { useVisionDebugStore } from '../../application/stores/visionDebugStore';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { Scoreboard } from '../components/Scoreboard';
import { ThrowEditor } from '../components/ThrowEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DART_MARKER_COLORS, DartBoard } from '../components/DartBoard';
import { LiveSnapshot } from '../components/LiveSnapshot';
import { PrepBoardGuideOverlay, usePrepBoardGuide } from '../components/PrepBoardGuide';
import { ShareButton } from '../components/ShareButton';
import { PlacementGuide } from '../components/PlacementGuide';
import {
  buildCurrentRoundShare,
  keepConfirmedRoundPhoto,
  listGameHighlights,
  loadRoundBests,
  pruneRoundPhotos,
  roundKey,
  roundPhotoName,
  saveCurrentRoundPhotos,
  type HighlightContext,
} from '../../application/services/shareService';
import type { RoundBest } from '../../domain/share/highlights';
import { highlightName } from '../../domain/share/highlights';
import { displayPlayerName } from '../../domain/game/players';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { isRealBullTrackNativeBridgeAvailable } from '../../native-bridge/bulltrack/bullTrackNative';
import { BullTrackPreview } from '../../native-bridge/bulltrack/BullTrackPreview';
import type { ThrowResult } from '../../domain/game/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_SLIDER_HEIGHT = 220;
// Until the frame is laid out; it is then square, as wide as the screen allows.
const PREVIEW_HEIGHT = 320;
const ZOOM_THUMB_SIZE = 26;
const AUTO_ZOOM_DURATION_MS = 400;
const AUTO_ZOOM_STEP_MS = 33;

export const GameScreen = ({ navigation }: Props) => {
  const { t } = useTranslation();
  const [runningAction, setRunningAction] = useState<
    'permission' | 'prepare' | 'start' | 'stop' | 'redetect' | 'confirm' | 'reload' | 'undo' | null
  >(null);
  // Set while the native preview is showing frames.
  const [previewReady, setPreviewReady] = useState(false);
  const [handoffInProgress, setHandoffInProgress] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [zoomTrackHeight, setZoomTrackHeight] = useState(ZOOM_SLIDER_HEIGHT);
  const [previewZoomRatio, setPreviewZoomRatio] = useState(() => useSettingsStore.getState().zoomRatio);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // A marker is being dragged; the board's share button gives its corner to the value badge.
  const [markerDragging, setMarkerDragging] = useState(false);
  // Per player name: earlier matches of this mode and their best round, for personal bests.
  const [roundBests, setRoundBests] = useState<Map<string, RoundBest>>(new Map());
  const [frameWidth, setFrameWidth] = useState(0);
  const [leaveDialog, setLeaveDialog] = useState<'roundInProgress' | 'confirm' | null>(null);
  // Set once an in-app re-request was denied too; the next tap opens system settings.
  const [permissionDenied, setPermissionDenied] = useState(false);
  // The player dragged the zoom slider while getting ready; auto zoom waits for the next round.
  const [autoZoomPaused, setAutoZoomPaused] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const autoZoomTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const allowLeaveRef = useRef(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const latestZoomRef = useRef(previewZoomRatio);
  const zoomDragStartRef = useRef({ pageY: 0, zoomRatio: previewZoomRatio });
  const isFocused = useIsFocused();

  const {
    status,
    selectedMode,
    selectedModeLabel,
    players,
    teams,
    currentPlayerId,
    scoreBoard,
    currentRoundNumber,
    currentThrowNumber,
    currentThrows,
    winnerId,
    statusMessage,
    errorMessage,
    errorAboutPlacement,
    cameraPermissionGranted,
    backCamera,
    cameraStatus,
    canRedetect,
    setCameraStatus,
    replaceThrow,
    captureReady,
    setupHint,
    setupHintAboutPlacement,
    reopenedRound,
    completedRounds,
    savedMatchId,
  } = useGameStore();
  // backCamera stays null until the camera has been prepared; only a known miss shows the message.
  const hasBackCamera = backCamera?.hasBackCamera === true;
  const backCameraMissing = backCamera?.hasBackCamera === false;
  const maxZoomRatio = backCamera?.maxZoomRatio;
  const previousStatusRef = useRef(status);
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const recordFrames = useSettingsStore(state => state.recordFrames);
  const selfMocking = useSettingsStore(state => state.highlightSelfMocking);
  const settingsLoaded = useSettingsStore(state => state.loaded);
  const placementGuideSeen = useSettingsStore(state => state.placementGuideSeen);
  const gameStartedAt = useGameStore(state => state.gameStartedAt);
  const artifactCount = useVisionDebugStore(state => state.artifacts.length);
  const lastNativeError = useVisionDebugStore(state => state.lastNativeError);

  const playerNames = players.map(player => player.name).join('\n');
  // Personal bests compare with the matches started before this game, loaded once per game.
  useEffect(() => {
    if (!selectedMode || gameStartedAt === null) {
      setRoundBests(new Map());
      return;
    }
    let active = true;
    loadRoundBests(selectedMode, playerNames.split('\n'), gameStartedAt).then(bests => {
      if (active) {
        setRoundBests(bests);
      }
    });
    return () => {
      active = false;
    };
  }, [selectedMode, playerNames, gameStartedAt]);

  const highlightContext = useMemo<HighlightContext>(
    () => ({ bests: roundBests, selfMocking }),
    [roundBests, selfMocking],
  );
  // completedRounds drives the replay; the service reads the rest of the game from the store.
  const gameHighlights = useMemo(
    () => (completedRounds.length > 0 ? listGameHighlights(highlightContext) : []),
    [completedRounds, highlightContext],
  );
  // A newly confirmed round keeps its photo when it was a highlight (native holds the round's
  // photo until the next round starts); an undo changes nothing.
  const confirmedCountRef = useRef(completedRounds.length);
  useEffect(() => {
    const confirmedBefore = confirmedCountRef.current;
    confirmedCountRef.current = completedRounds.length;
    const round = completedRounds[completedRounds.length - 1];
    if (completedRounds.length <= confirmedBefore || !round || gameStartedAt === null) {
      return;
    }
    const seat = players.findIndex(player => player.id === round.playerId);
    const key = roundKey(round.roundIndex, players[seat]?.name ?? '');
    keepConfirmedRoundPhoto(
      roundPhotoName(gameStartedAt, round.roundIndex, seat),
      gameHighlights.some(item => item.key === key),
    ).catch(() => undefined);
  }, [completedRounds, gameHighlights, players, gameStartedAt]);
  // Once the game is saved, only the newest matches keep their photos.
  useEffect(() => {
    if (savedMatchId !== null) {
      pruneRoundPhotos().catch(() => undefined);
    }
  }, [savedMatchId]);
  useEffect(() => {
    ensureBullTrackSubscriptions();
    setRunningAction('permission');
    requestCameraPermission()
      .then(granted => {
        if (granted) {
          setRunningAction('prepare');
          return prepareLiveCamera();
        }
        return undefined;
      })
      .finally(() => {
        setRunningAction(null);
      });
  }, []);

  // The first time the camera is ready for a round, the placement guide opens by itself.
  useEffect(() => {
    if (
      isFocused &&
      settingsLoaded &&
      !placementGuideSeen &&
      cameraPermissionGranted &&
      status === 'waitingForThrow'
    ) {
      setGuideOpen(true);
    }
  }, [isFocused, settingsLoaded, placementGuideSeen, cameraPermissionGranted, status]);

  const closeGuide = () => {
    setGuideOpen(false);
    if (!useSettingsStore.getState().placementGuideSeen) {
      useSettingsStore.getState().setPlacementGuideSeen().catch(() => undefined);
    }
  };

  // After being sent to system settings, pick up a newly granted permission on return.
  useEffect(() => {
    if (cameraPermissionGranted || !permissionDenied) {
      return;
    }
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        refreshCameraPermission()
          .then(granted => (granted ? prepareLiveCamera() : undefined))
          .catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [cameraPermissionGranted, permissionDenied]);

  useEffect(() => {
    if (!cameraPermissionGranted) {
      setPreviewReady(false);
      setCameraStatus({
        isReady: false,
        isPreviewBound: false,
        statusMessage: t('game.camera.needPermission'),
        lockPhase: 'IDLE',
        lockReason: null,
      });
      return;
    }

    if (backCameraMissing) {
      setPreviewReady(false);
      setCameraStatus({
        isReady: false,
        isPreviewBound: false,
        statusMessage: t('game.camera.noBackCamera'),
        lockPhase: 'FALLBACK',
        lockReason: 'Back camera device unavailable',
      });
      return;
    }

    if (!previewReady) {
      setCameraStatus({
        isReady: false,
        isPreviewBound: false,
        statusMessage: t('game.camera.waitingPreview'),
        lockPhase: 'IDLE',
        lockReason: null,
      });
      return;
    }

    setCameraStatus({
      isReady: true,
      isPreviewBound: true,
      statusMessage: t('game.camera.previewReady'),
      lockPhase: 'IDLE',
      lockReason: null,
    });
  }, [backCameraMissing, cameraPermissionGranted, previewReady, setCameraStatus, t]);

  // The person about to throw; in a team game currentPlayerId is the team.
  const currentThrowerId = getCurrentThrowerId({ teams, scoreBoard, currentPlayerId });
  const currentPlayer = useMemo(
    () => players.find(player => player.id === currentThrowerId) ?? null,
    [currentThrowerId, players],
  );
  const currentTeam = teams?.find(team => team.id === currentPlayerId) ?? null;
  // A player, or a whole team.
  const winner = useMemo(
    () => (scoreBoard?.players ?? players).find(side => side.id === winnerId) ?? null,
    [players, scoreBoard, winnerId],
  );
  const totalScore = useMemo(
    () => currentThrows.reduce((sum, item) => sum + item.score, 0),
    [currentThrows],
  );
  const isBusy = runningAction !== null;
  // The native preview holds the camera while mounted, so it is only mounted while shown. It stays
  // mounted (under the board) through a round's start, so the round keeps the camera it opened and
  // takes the preview stream off itself; a redetect, which also reports a starting round, does not
  // bring it back.
  const shouldShowPreview =
    isFocused &&
    cameraPermissionGranted &&
    hasBackCamera &&
    (status === 'waitingForThrow' || (status === 'roundInProgress' && handoffInProgress));
  const zoomRange = useMemo(() => {
    const maxZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, maxZoomRatio ?? ZOOM_MAX));
    return {
      min: ZOOM_MIN,
      max: maxZoom,
    };
  }, [maxZoomRatio]);
  const canAdjustZoom =
    cameraPermissionGranted &&
    hasBackCamera &&
    previewReady &&
    status === 'waitingForThrow' &&
    !isBusy &&
    !handoffInProgress;

  // The slider (persisted in settings) is the single source of zoom; native status events
  // never overwrite it, so it carries over between rounds and games, failed or not.
  useEffect(() => {
    const clamped = Math.min(zoomRange.max, Math.max(zoomRange.min, latestZoomRef.current));
    latestZoomRef.current = clamped;
    setPreviewZoomRatio(clamped);
  }, [zoomRange.max, zoomRange.min]);

  // The handoff lasts until the empty-board first frame is in, or the round ends (failed) first.
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (
      (status === 'roundInProgress' && captureReady) ||
      (previousStatus === 'roundInProgress' && status !== 'roundInProgress')
    ) {
      setHandoffInProgress(false);
    }
  }, [status, captureReady]);

  // An unmounted preview cannot report that it stopped.
  useEffect(() => {
    if (!shouldShowPreview) {
      setPreviewReady(false);
    }
  }, [shouldShowPreview]);

  // Each new wait between rounds gives auto zoom another go.
  useEffect(() => {
    if (status === 'waitingForThrow') {
      setAutoZoomPaused(false);
    }
  }, [status]);

  const stopAutoZoom = () => {
    if (autoZoomTimerRef.current) {
      clearInterval(autoZoomTimerRef.current);
      autoZoomTimerRef.current = null;
    }
  };

  useEffect(() => stopAutoZoom, []);

  // A zoom still easing in when the slider locks (a round starts) stays where it got to.
  useEffect(() => {
    if (!canAdjustZoom && autoZoomTimerRef.current) {
      stopAutoZoom();
      persistZoomRatio();
    }
  }, [canAdjustZoom]);

  const commitZoomRatio = (nextZoomRatio: number) => {
    const clamped = Math.min(zoomRange.max, Math.max(zoomRange.min, nextZoomRatio));
    latestZoomRef.current = clamped;
    setPreviewZoomRatio(clamped);
    setCameraStatus({ zoomRatio: clamped });
  };

  const persistZoomRatio = () => {
    updateLiveZoomRatio(latestZoomRef.current).catch(() => undefined);
    // Remembered across games, since the phone mount usually stays put.
    useSettingsStore.getState().setZoomRatio(latestZoomRef.current).catch(() => undefined);
  };

  // Relative drag: the zoom follows the finger's vertical movement from where it touched,
  // so no absolute track position (which shifts when the page scrolls) is needed.
  const beginZoomDrag = (pageY: number) => {
    if (!canAdjustZoom) {
      return;
    }
    stopAutoZoom();
    setAutoZoomPaused(true);
    setScrollEnabled(false);
    zoomDragStartRef.current = { pageY, zoomRatio: latestZoomRef.current };
  };

  const moveZoomDrag = (pageY: number) => {
    if (!canAdjustZoom) {
      return;
    }
    const usableHeight = Math.max(1, zoomTrackHeight - ZOOM_THUMB_SIZE);
    const start = zoomDragStartRef.current;
    const deltaRatio = ((start.pageY - pageY) / usableHeight) * (zoomRange.max - zoomRange.min);
    commitZoomRatio(start.zoomRatio + deltaRatio);
  };

  const endZoomDrag = () => {
    setScrollEnabled(true);
    persistZoomRatio();
  };

  // Eases the zoom over a short while instead of jumping, then keeps it like a slider change.
  const animateZoomTo = (target: number) => {
    stopAutoZoom();
    const from = latestZoomRef.current;
    const startedAt = Date.now();
    autoZoomTimerRef.current = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / AUTO_ZOOM_DURATION_MS);
      commitZoomRatio(from + (target - from) * (1 - (1 - progress) * (1 - progress)));
      if (progress >= 1) {
        stopAutoZoom();
        persistZoomRatio();
      }
    }, AUTO_ZOOM_STEP_MS);
  };

  const prepGuide = usePrepBoardGuide({
    active: isFocused && canAdjustZoom,
    zoomMin: zoomRange.min,
    zoomMax: zoomRange.max,
    autoZoomPaused,
    getZoom: () => latestZoomRef.current,
    zoomTo: animateZoomTo,
  });

  const thumbOffset = useMemo(() => {
    const usableHeight = Math.max(1, zoomTrackHeight - ZOOM_THUMB_SIZE);
    const zoomSpan = Math.max(0.0001, zoomRange.max - zoomRange.min);
    const normalized = (previewZoomRatio - zoomRange.min) / zoomSpan;
    return (1 - normalized) * usableHeight;
  }, [previewZoomRatio, zoomRange.max, zoomRange.min, zoomTrackHeight]);

  const runAction = (
    action: NonNullable<typeof runningAction>,
    task: () => Promise<unknown>,
  ) => {
    setRunningAction(action);
    task()
      .catch(() => undefined)
      .finally(() => {
        setRunningAction(null);
      });
  };

  const retryCameraPermission = () => {
    if (permissionDenied) {
      Linking.openSettings().catch(() => undefined);
      return;
    }
    runAction('permission', async () => {
      if (await requestCameraPermission()) {
        await prepareLiveCamera();
      } else {
        setPermissionDenied(true);
      }
    });
  };

  // The round takes over the camera the preview opened (no reopen): the preview stays mounted under
  // the board until the first frame is in, and native code takes the preview stream off after it.
  const startRound = () => {
    if (autoZoomTimerRef.current) {
      // The round takes the zoom an easing auto zoom got to; keep it as a finished one would be.
      stopAutoZoom();
      useSettingsStore.getState().setZoomRatio(latestZoomRef.current).catch(() => undefined);
    }
    setRunningAction('start');
    setHandoffInProgress(true);
    Promise.resolve()
      .then(() => updateLiveZoomRatio(latestZoomRef.current))
      .then(() => startLiveRound())
      .finally(() => {
        setRunningAction(null);
      })
      .catch(() => {
        setHandoffInProgress(false);
      });
  };

  const playAgain = () => {
    if (!selectedMode) {
      return;
    }
    resetLiveGameSession();
    startGameSession(
      selectedMode,
      players.map(player => player.name),
      selectedModeLabel ?? selectedMode,
      teams ? players.map(player => player.teamIndex ?? 0) : undefined,
    );
  };

  const leaveGame = (leave: () => void) => {
    allowLeaveRef.current = true;
    abandonCurrentRound().finally(() => {
      resetLiveGameSession();
      leave();
    });
  };

  const goHome = () =>
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });

  const exitGame = () => leaveGame(goHome);

  // The result on the board as it stands (edited or not); after the game, the match too,
  // opened on its highlights when a key is given.
  const openShare = async (highlight?: string) => {
    const share = buildCurrentRoundShare(highlightContext);
    const matchId = status === 'gameOver' ? savedMatchId ?? undefined : undefined;
    if (!share && matchId === undefined) {
      return;
    }
    // The photo of the round on screen (still in native memory) goes along with its card.
    const photos = share ? await saveCurrentRoundPhotos().catch(() => null) : null;
    navigation.navigate('SharePreview', {
      round: share ? { ...share, photos } : undefined,
      matchId,
      highlight: matchId !== undefined ? highlight : undefined,
    });
  };

  const confirmLeave = (leave: () => void) => {
    if (useGameStore.getState().status === 'roundInProgress') {
      setLeaveDialog('roundInProgress');
      return;
    }
    pendingLeaveRef.current = leave;
    setLeaveDialog('confirm');
  };

  const closeLeaveDialog = () => {
    pendingLeaveRef.current = null;
    setLeaveDialog(null);
  };

  const confirmLeaveDialog = () => {
    const leave = pendingLeaveRef.current;
    closeLeaveDialog();
    if (leave) {
      leaveGame(leave);
    }
  };

  const confirmExit = () => confirmLeave(goHome);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', event => {
        const currentStatus = useGameStore.getState().status;
        if (allowLeaveRef.current || currentStatus === 'gameOver' || currentStatus === 'idle') {
          return;
        }
        event.preventDefault();
        confirmLeave(() => navigation.dispatch(event.data.action));
      }),
    // confirmLeave only reads fresh store state, so subscribing once is enough.
    [navigation],
  );

  const canEditThrows = status === 'showingResult' && !isBusy;
  const showBoard = status !== 'waitingForThrow';
  // During a round the frame is split: near-live snapshot left, board right.
  const splitView = status === 'roundInProgress';
  const previewSize = frameWidth > 0 ? frameWidth : PREVIEW_HEIGHT;
  const boardSize = Math.max(
    0,
    Math.min(splitView ? frameWidth / 2 : frameWidth, previewSize) - 12,
  );
  const boardBadge =
    status === 'roundInProgress'
      ? captureReady
        ? t('game.badge.canThrow')
        : t('game.badge.preparing')
      : status === 'showingResult'
        ? t('game.badge.dragToFix')
        : status === 'gameOver'
          ? t('game.badge.gameOver')
          : null;
  const turnHeadline =
    status === 'gameOver'
      ? winner
        ? t('game.headline.winner', { name: displayPlayerName(winner.name) })
        : t('game.headline.noWinner')
      : status === 'roundInProgress'
        ? captureReady
          ? t('game.headline.throwNow', { n: currentThrowNumber })
          : t('game.headline.preparing')
        : status === 'showingResult'
          ? t('game.headline.confirm')
          : t('game.headline.turn', {
              name: currentPlayer ? displayPlayerName(currentPlayer.name) : t('game.headline.playerFallback'),
              team: currentTeam ? t('game.headline.turnTeam', { team: currentTeam.name }) : '',
              round: currentRoundNumber,
            });
  // Only the latest confirmed round can be taken back, between rounds or after the game.
  const undoButton =
    completedRounds.length > 0 ? (
      <SecondaryButton
        label={runningAction === 'undo' ? t('game.undoing') : t('game.undoLastRound')}
        onPress={() => runAction('undo', undoLastRound)}
        disabled={isBusy}
      />
    ) : null;
  const turnHint =
    status === 'showingResult'
      ? reopenedRound
        ? t('game.hint.reopened')
        : t('game.hint.tapToFix')
      : status === 'roundInProgress'
        ? captureReady
          ? t('game.hint.autoEnd')
          : t('game.hint.capturingEmpty')
        : status === 'waitingForThrow'
          ? t('game.hint.pullDarts')
          : null;

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      scrollEnabled={scrollEnabled}>
      {recordFrames ? (
        <View style={styles.recordingBanner}>
          <Text style={styles.recordingBannerText}>
            {t('game.recordingBanner')}
          </Text>
        </View>
      ) : null}
      <Scoreboard
        gameType={selectedMode}
        players={scoreBoard?.players ?? players}
        currentPlayerId={currentPlayerId}
        winnerId={winnerId}
        teams={teams}
        people={players}
        currentThrowerId={currentThrowerId}
      />

      <View
        style={[styles.previewFrame, { height: previewSize }]}
        collapsable={false}
        onLayout={event => setFrameWidth(Math.round(event.nativeEvent.layout.width))}>
        {cameraPermissionGranted && !backCameraMissing ? (
          shouldShowPreview ? (
            <BullTrackPreview
              style={[styles.preview, { height: previewSize }]}
              zoomRatio={previewZoomRatio}
              onPreviewStateChange={event => setPreviewReady(event.nativeEvent.streaming)}
            />
          ) : (
            <View style={[styles.preview, { height: previewSize }]} />
          )
        ) : (
          <View style={styles.previewFallback}>
            <Text style={styles.fallbackText}>
              {cameraPermissionGranted ? t('game.noBackCamera') : t('game.needCameraPermission')}
            </Text>
            {!cameraPermissionGranted && runningAction !== 'permission' ? (
              <>
                <PrimaryButton
                  label={permissionDenied ? t('game.openSystemSettings') : t('game.allowCamera')}
                  onPress={retryCameraPermission}
                />
                {permissionDenied ? (
                  <Text style={styles.fallbackHint}>{t('game.permissionHint')}</Text>
                ) : null}
              </>
            ) : null}
          </View>
        )}
        {!showBoard && shouldShowPreview ? (
          <PrepBoardGuideOverlay size={previewSize} view={prepGuide} />
        ) : null}
        {!showBoard && cameraPermissionGranted && !backCameraMissing ? (
          <Pressable
            accessibilityLabel={t('guide.open')}
            hitSlop={8}
            onPress={() => setGuideOpen(true)}
            style={({ pressed }) => [styles.guideButton, pressed && styles.guideButtonPressed]}>
            <Text style={styles.guideButtonLabel}>?</Text>
          </Pressable>
        ) : null}
        {showBoard ? (
          <View style={[styles.boardLayer, splitView && styles.boardLayerSplit]}>
            {splitView ? <LiveSnapshot /> : null}
            <View style={splitView ? styles.boardHalf : null}>
              {boardSize > 0 ? (
                <DartBoard
                  size={boardSize}
                  throws={currentThrows}
                  editable={canEditThrows}
                  onThrowChange={replaceThrow}
                  onDragChange={setMarkerDragging}
                />
              ) : null}
            </View>
            {boardBadge ? (
              <View style={styles.boardBadge} pointerEvents="none">
                <Text style={styles.boardBadgeLabel}>{boardBadge}</Text>
              </View>
            ) : null}
            {status === 'showingResult' && currentThrows.length > 0 && !markerDragging ? (
              <ShareButton variant="overlay" onPress={() => openShare()} style={styles.boardShare} />
            ) : null}
          </View>
        ) : null}
        <View
          style={[styles.zoomOverlay, showBoard && styles.hidden]}
          pointerEvents={showBoard ? 'none' : 'box-none'}>
          <Text style={styles.zoomCurrentLabel}>{previewZoomRatio.toFixed(1)}x</Text>
          <View
            style={[
              styles.zoomTrackShell,
              !canAdjustZoom && styles.zoomTrackShellDisabled,
            ]}
            onStartShouldSetResponderCapture={() => canAdjustZoom}
            onMoveShouldSetResponderCapture={() => canAdjustZoom}
            onStartShouldSetResponder={() => canAdjustZoom}
            onMoveShouldSetResponder={() => canAdjustZoom}
            onResponderTerminationRequest={() => false}
            onResponderGrant={event => {
              beginZoomDrag(event.nativeEvent.pageY);
              // Returning true blocks the native ScrollView from stealing the drag (Android).
              return true;
            }}
            onResponderMove={event => {
              moveZoomDrag(event.nativeEvent.pageY);
            }}
            onResponderRelease={endZoomDrag}
            onResponderTerminate={endZoomDrag}
          >
            <Text style={styles.zoomScaleLabel}>{zoomRange.max.toFixed(1)}x</Text>
            <View
              style={styles.zoomTrack}
              onLayout={event => {
                const nextHeight = Math.round(event.nativeEvent.layout.height);
                setZoomTrackHeight(current => (current === nextHeight ? current : nextHeight));
              }}>
              <View style={styles.zoomTrackFill} />
              <View
                style={[
                  styles.zoomThumb,
                  {
                    top: thumbOffset,
                  },
                ]}
              />
            </View>
            <Text style={styles.zoomScaleLabel}>{zoomRange.min.toFixed(1)}x</Text>
          </View>
        </View>
      </View>

      <View style={styles.turnBlock}>
        <View style={styles.rowBetween}>
          <Text style={styles.turnHeadline}>{turnHeadline}</Text>
          {status === 'gameOver' ? (
            <Pressable
              onPress={() => openShare()}
              style={({ pressed }) => [styles.shareResultButton, pressed && styles.dartSlotPressed]}>
              <Text style={styles.shareResultLabel}>{t('game.shareResult')}</Text>
            </Pressable>
          ) : (
            <Text style={styles.totalScore}>{totalScore}</Text>
          )}
        </View>
        {status === 'gameOver' && gameHighlights.length > 0 ? (
          <Pressable disabled={savedMatchId === null} onPress={() => openShare(gameHighlights[0].key)}>
            <Text numberOfLines={2} style={styles.gameHighlights}>
              {t('game.gameHighlights')}
              {gameHighlights
                .map(item => `${displayPlayerName(item.share.playerName)} ${item.share.highlight ? highlightName(item.share.highlight) : ''}`)
                .join(' · ')}
            </Text>
          </Pressable>
        ) : null}
        {turnHint ? <Text style={styles.hint}>{turnHint}</Text> : null}
        {prepGuide?.board?.dartTips.length ? (
          <Text style={styles.setupHint}>{t('game.hint.dartsOnBoard')}</Text>
        ) : null}
        {setupHint ?<Text style={styles.setupHint}>{setupHint}</Text> : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        {(errorMessage && errorAboutPlacement) || (setupHint && setupHintAboutPlacement) ? (
          <Pressable hitSlop={6} onPress={() => setGuideOpen(true)}>
            <Text style={styles.guideLink}>{t('guide.link')}</Text>
          </Pressable>
        ) : null}
        <View style={styles.dartRow}>
          {[0, 1, 2].map(index => {
            const item = currentThrows[index];
            return (
              <Pressable
                key={index}
                disabled={!canEditThrows || !item}
                onPress={() => setEditingIndex(index)}
                style={({ pressed }) => [
                  styles.dartSlot,
                  canEditThrows && item && styles.dartSlotEditable,
                  pressed && styles.dartSlotPressed,
                ]}>
                <View
                  style={[
                    styles.dartDot,
                    { backgroundColor: DART_MARKER_COLORS[index] },
                    !item && styles.dartDotEmpty,
                  ]}>
                  <Text style={styles.dartDotLabel}>{index + 1}</Text>
                </View>
                <Text style={styles.dartLabel}>{item ? formatThrowLabel(item, t) : '—'}</Text>
                <Text style={styles.dartScore}>{item ? item.score : ''}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.actionGroup}>
        {status === 'gameOver' ? (
          <>
            <PrimaryButton label={t('game.playAgain')} onPress={playAgain} disabled={isBusy} />
            {undoButton}
            <SecondaryButton label={t('game.backHome')} onPress={exitGame} disabled={isBusy} />
          </>
        ) : status === 'roundInProgress' ? (
          <PrimaryButton
            label={runningAction === 'stop' ? t('game.stopping') : t('game.endRound')}
            onPress={() => runAction('stop', stopLiveRound)}
            disabled={isBusy}
          />
        ) : status === 'showingResult' ? (
          <>
            <PrimaryButton
              label={runningAction === 'confirm' ? t('game.confirming') : t('game.confirm')}
              onPress={() => runAction('confirm', confirmCurrentRound)}
              disabled={isBusy || currentThrows.length === 0}
            />
            {reopenedRound ? (
              <SecondaryButton
                label={t('game.rethrowRound')}
                onPress={discardReopenedRound}
                disabled={isBusy}
              />
            ) : (
              <SecondaryButton
                label={runningAction === 'redetect' ? t('game.redetecting') : t('game.redetect')}
                onPress={() => runAction('redetect', redetectCurrentRound)}
                disabled={isBusy || !canRedetect || !hasBackCamera}
              />
            )}
          </>
        ) : (
          <>
            <PrimaryButton
              label={runningAction === 'start' ? t('game.starting') : t('game.startRound')}
              onPress={startRound}
              disabled={isBusy || !cameraPermissionGranted || !hasBackCamera || !previewReady}
            />
            {undoButton}
          </>
        )}
        {status !== 'gameOver' ? (
          <Pressable
            onPress={confirmExit}
            disabled={isBusy || status === 'roundInProgress'}
            style={styles.exitButton}>
            <Text style={styles.exitLabel}>{t('game.exitGame')}</Text>
          </Pressable>
        ) : null}
      </View>

      {showDebugInfo ? (
        <Panel>
          <Text style={styles.panelTitle}>{t('game.debug.title')}</Text>
          <Text style={styles.debugText}>{statusMessage}</Text>
          {lastNativeError ? (
            <Text style={styles.debugText}>{t('game.debug.nativeError', { error: lastNativeError })}</Text>
          ) : null}
          <Text style={styles.debugText}>{cameraStatus.statusMessage}</Text>
          <Text style={styles.debugText}>
            {status} · Zoom {cameraStatus.zoomRatio.toFixed(2)}x · {cameraStatus.lockPhase} ·{' '}
            {isRealBullTrackNativeBridgeAvailable ? 'native' : 'mock'} ·{' '}
            {t('game.debug.images', { n: artifactCount })}
          </Text>
          {currentThrows.map(item => (
            <Text key={item.id} style={styles.debugText}>
              {item.label} ({item.pointNorm.x.toFixed(2)}, {item.pointNorm.y.toFixed(2)})
            </Text>
          ))}
          {cameraStatus.lockReason ? (
            <Text style={styles.debugText}>{cameraStatus.lockReason}</Text>
          ) : null}
          <View style={styles.inlineActions}>
            <SecondaryButton
              label={t('game.debug.refreshImages')}
              onPress={() => runAction('reload', reloadDebugArtifacts)}
              disabled={isBusy}
            />
            <SecondaryButton
              label={t('game.debug.viewImages')}
              onPress={() => navigation.navigate('Debug')}
              disabled={isBusy}
            />
          </View>
        </Panel>
      ) : null}

      <ThrowEditor
        visible={editingIndex !== null}
        initialThrow={editingIndex !== null ? currentThrows[editingIndex] ?? null : null}
        onCancel={() => setEditingIndex(null)}
        onSave={throwResult => {
          if (editingIndex !== null) {
            replaceThrow(editingIndex, throwResult);
          }
          setEditingIndex(null);
        }}
      />

      <ConfirmDialog
        visible={leaveDialog === 'roundInProgress'}
        title={t('game.dialog.detectingTitle')}
        message={t('game.dialog.detectingMessage')}
        confirmLabel={t('game.dialog.gotIt')}
        onConfirm={closeLeaveDialog}
        onCancel={closeLeaveDialog}
      />
      <ConfirmDialog
        visible={leaveDialog === 'confirm'}
        title={t('game.exitGame')}
        message={t('game.dialog.leaveMessage')}
        confirmLabel={t('game.dialog.leave')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={confirmLeaveDialog}
        onCancel={closeLeaveDialog}
      />
      <PlacementGuide visible={guideOpen} onClose={closeGuide} />
    </ScrollView>
  );
};

const formatThrowLabel = (
  throwResult: ThrowResult,
  t: (key: 'common.innerBull' | 'common.outerBull' | 'common.miss') => string,
) => {
  switch (throwResult.ring) {
    case 'innerBull':
      return t('common.innerBull');
    case 'outerBull':
      return t('common.outerBull');
    case 'miss':
      return t('common.miss');
    default:
      return throwResult.label.startsWith('S') ? throwResult.label.slice(1) : throwResult.label;
  }
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: 16,
    paddingBottom: 36,
    gap: 14,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  previewFrame: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  preview: {
    width: '100%',
  },
  boardLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#15120F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardLayerSplit: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  boardHalf: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(242, 168, 61, 0.92)',
  },
  boardBadgeLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E1A16',
  },
  boardShare: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  gameHighlights: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  hidden: {
    opacity: 0,
  },
  guideButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(12, 16, 24, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    elevation: 20,
  },
  guideButtonPressed: {
    opacity: 0.7,
  },
  guideButtonLabel: {
    color: '#F7F8FA',
    fontSize: 17,
    fontWeight: '800',
  },
  guideLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.info,
  },
  zoomOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    bottom: 10,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
  },
  zoomTrackShell: {
    width: 52,
    height: ZOOM_SLIDER_HEIGHT,
    borderRadius: 24,
    backgroundColor: 'rgba(12, 16, 24, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    zIndex: 21,
    elevation: 21,
  },
  zoomTrackShellDisabled: {
    opacity: 0.56,
  },
  zoomCurrentLabel: {
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(12, 16, 24, 0.82)',
    color: '#F7F8FA',
    fontSize: 12,
    fontWeight: '800',
  },
  zoomScaleLabel: {
    color: '#D7DBE2',
    fontSize: 11,
    fontWeight: '700',
  },
  zoomTrack: {
    flex: 1,
    width: 8,
    marginVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    position: 'relative',
    justifyContent: 'center',
  },
  zoomTrackFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(242, 168, 61, 0.34)',
  },
  zoomThumb: {
    position: 'absolute',
    left: -9,
    width: ZOOM_THUMB_SIZE,
    height: ZOOM_THUMB_SIZE,
    borderRadius: 999,
    backgroundColor: '#F2A83D',
    borderWidth: 2,
    borderColor: '#FFF7E6',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  previewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 14,
  },
  fallbackText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F7F8FA',
  },
  fallbackHint: {
    fontSize: 13,
    color: '#D7DBE2',
    textAlign: 'center',
  },
  turnBlock: {
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  turnHeadline: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  totalScore: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.accent,
  },
  shareResultButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  shareResultLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.accent,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  recordingBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F2A83D',
  },
  recordingBannerText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E1A16',
  },
  setupHint: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.warning,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
  },
  dartRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dartSlot: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 2,
  },
  dartSlotEditable: {
    borderColor: colors.accent,
    borderWidth: 1.5,
  },
  dartDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dartDotEmpty: {
    opacity: 0.35,
  },
  dartDotLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E1A16',
  },
  dartSlotPressed: {
    backgroundColor: colors.panelStrong,
  },
  dartLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  dartScore: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  actionGroup: {
    gap: 10,
  },
  exitButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  exitLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  debugText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 10,
  },
});
