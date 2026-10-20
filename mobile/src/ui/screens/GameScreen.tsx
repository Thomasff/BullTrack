import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
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
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { isRealBullTrackNativeBridgeAvailable } from '../../native-bridge/bulltrack/bullTrackNative';
import type { ThrowResult } from '../../domain/game/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_SLIDER_HEIGHT = 220;
const PREVIEW_HEIGHT = 320;
const ZOOM_THUMB_SIZE = 26;

export const GameScreen = ({ navigation }: Props) => {
  const [runningAction, setRunningAction] = useState<
    'permission' | 'prepare' | 'start' | 'stop' | 'redetect' | 'confirm' | 'reload' | 'undo' | null
  >(null);
  const [previewReady, setPreviewReady] = useState(false);
  // VisionCamera drops a zoom set while the camera is still opening, so the zoom prop
  // is only passed once the preview is streaming (the change then gets applied).
  const [previewStreaming, setPreviewStreaming] = useState(false);
  const [handoffInProgress, setHandoffInProgress] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [previewInstanceKey, setPreviewInstanceKey] = useState(0);
  const [zoomTrackHeight, setZoomTrackHeight] = useState(ZOOM_SLIDER_HEIGHT);
  const [previewZoomRatio, setPreviewZoomRatio] = useState(() => useSettingsStore.getState().zoomRatio);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [leaveDialog, setLeaveDialog] = useState<'roundInProgress' | 'confirm' | null>(null);
  // Set once an in-app re-request was denied too; the next tap opens system settings.
  const [permissionDenied, setPermissionDenied] = useState(false);
  const allowLeaveRef = useRef(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const latestZoomRef = useRef(previewZoomRatio);
  const zoomDragStartRef = useRef({ pageY: 0, zoomRatio: previewZoomRatio });
  const isFocused = useIsFocused();
  const device = useCameraDevice('back');
  // Native round capture is a 16:9 frame center-cropped to 9:16 portrait. Using the
  // same 16:9 output here keeps everything visible in the preview inside the analyzed
  // frame (the default would be the max-resolution, usually 4:3, format), and a
  // 1080p preview is cheaper than the sensor maximum. With video disabled, VisionCamera
  // sizes the preview from the format's photo size, so filter on the photo fields.
  const format = useCameraFormat(device, [
    { photoAspectRatio: 16 / 9 },
    { photoResolution: { width: 1920, height: 1080 } },
    { fps: 30 },
  ]);

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
    cameraPermissionGranted,
    cameraStatus,
    canRedetect,
    setCameraStatus,
    replaceThrow,
    captureReady,
    reopenedRound,
    completedRounds,
  } = useGameStore();
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const previousStatusRef = useRef(status);
  const artifactCount = useVisionDebugStore(state => state.artifacts.length);
  const lastNativeError = useVisionDebugStore(state => state.lastNativeError);

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
        statusMessage: '需要相机权限才能显示预览',
        lockPhase: 'IDLE',
        lockReason: null,
      });
      return;
    }

    if (!device) {
      setPreviewReady(false);
      setCameraStatus({
        isReady: false,
        isPreviewBound: false,
        statusMessage: '未找到后置相机设备',
        lockPhase: 'FALLBACK',
        lockReason: 'Back camera device unavailable',
      });
      return;
    }

    if (!previewReady) {
      setCameraStatus({
        isReady: false,
        isPreviewBound: false,
        statusMessage: '相机已初始化，等待预览',
        lockPhase: 'IDLE',
        lockReason: null,
      });
      return;
    }

    setCameraStatus({
      isReady: true,
      isPreviewBound: true,
      statusMessage: '相机预览已就绪',
      lockPhase: 'IDLE',
      lockReason: null,
    });
  }, [cameraPermissionGranted, device, previewReady, setCameraStatus]);

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
  const shouldShowVisionPreview =
    isFocused &&
    cameraPermissionGranted &&
    !!device &&
    status === 'waitingForThrow' &&
    !handoffInProgress;
  const zoomRange = useMemo(() => {
    const maxZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, device?.maxZoom ?? ZOOM_MAX));
    return {
      min: ZOOM_MIN,
      max: maxZoom,
    };
  }, [device]);
  const canAdjustZoom =
    cameraPermissionGranted &&
    !!device &&
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

  useEffect(() => {
    if (status !== 'waitingForThrow') {
      setHandoffInProgress(false);
    }
  }, [status]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    if (status === 'waitingForThrow' && previousStatus !== 'waitingForThrow') {
      setPreviewReady(false);
      setPreviewStreaming(false);
      setPreviewInstanceKey(current => current + 1);
    }
    previousStatusRef.current = status;
  }, [status]);

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

  const startRound = () => {
    setRunningAction('start');
    setHandoffInProgress(true);
    Promise.resolve()
      .then(() => updateLiveZoomRatio(latestZoomRef.current))
      .then(
        () =>
          new Promise<void>(resolve => {
            setTimeout(() => resolve(), 180);
          }),
      )
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
  const boardSize = Math.max(
    0,
    Math.min(splitView ? frameWidth / 2 : frameWidth, PREVIEW_HEIGHT) - 12,
  );
  const boardBadge =
    status === 'roundInProgress'
      ? captureReady
        ? '可以投镖了'
        : '准备中…'
      : status === 'showingResult'
        ? '拖动标记可修正'
        : status === 'gameOver'
          ? '比赛结束'
          : null;
  const turnHeadline =
    status === 'gameOver'
      ? `${winner?.name ?? '比赛'} 获胜`
      : status === 'roundInProgress'
        ? captureReady
          ? `请投镖 · 已识别 ${currentThrowNumber} 镖`
          : '准备中，先别投镖'
        : status === 'showingResult'
          ? '确认本轮结果'
          : `轮到 ${currentPlayer?.name ?? '玩家'}${currentTeam ? `（${currentTeam.name}）` : ''} · 第 ${currentRoundNumber} 轮`;
  // Only the latest confirmed round can be taken back, between rounds or after the game.
  const undoButton =
    completedRounds.length > 0 ? (
      <SecondaryButton
        label={runningAction === 'undo' ? '正在撤销…' : '撤销上一轮'}
        onPress={() => runAction('undo', undoLastRound)}
        disabled={isBusy}
      />
    ) : null;
  const turnHint =
    status === 'showingResult'
      ? reopenedRound
        ? '已撤销上一轮：点飞镖修改，或重投本轮'
        : '识别不对可以点飞镖修改'
      : status === 'roundInProgress'
        ? captureReady
          ? '投满 3 镖自动结束，也可以手动结束'
          : '正在拍摄空靶作为对照'
        : status === 'waitingForThrow'
          ? '拔下飞镖后开始本轮'
          : null;

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      scrollEnabled={scrollEnabled}>
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
        style={styles.previewFrame}
        collapsable={false}
        onLayout={event => setFrameWidth(Math.round(event.nativeEvent.layout.width))}>
        {cameraPermissionGranted && device ? (
          <Camera
            key={`preview-${previewInstanceKey}`}
            style={styles.preview}
            device={device}
            isActive={shouldShowVisionPreview}
            zoom={previewStreaming ? previewZoomRatio : ZOOM_MIN}
            onStarted={() => setPreviewStreaming(true)}
            onStopped={() => setPreviewStreaming(false)}
            format={format}
            resizeMode="cover"
            androidPreviewViewType="texture-view"
            onInitialized={() => {
              setPreviewReady(true);
            }}
            onError={error => {
              setPreviewReady(false);
              setCameraStatus({
                isReady: false,
                isPreviewBound: false,
                statusMessage: `相机预览失败: ${error.message}`,
                lockPhase: 'FALLBACK',
                lockReason: error.code,
              });
            }}
          />
        ) : (
          <View style={styles.previewFallback}>
            <Text style={styles.fallbackText}>
              {cameraPermissionGranted ? '未找到可用的后置相机' : '需要相机权限才能识别飞镖'}
            </Text>
            {!cameraPermissionGranted && runningAction !== 'permission' ? (
              <>
                <PrimaryButton
                  label={permissionDenied ? '打开系统设置' : '允许使用相机'}
                  onPress={retryCameraPermission}
                />
                {permissionDenied ? (
                  <Text style={styles.fallbackHint}>在系统设置的「权限」里允许相机，返回后自动生效</Text>
                ) : null}
              </>
            ) : null}
          </View>
        )}
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
                />
              ) : null}
            </View>
            {boardBadge ? (
              <View style={styles.boardBadge} pointerEvents="none">
                <Text style={styles.boardBadgeLabel}>{boardBadge}</Text>
              </View>
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
          <Text style={styles.totalScore}>{totalScore}</Text>
        </View>
        {turnHint ? <Text style={styles.hint}>{turnHint}</Text> : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
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
                <Text style={styles.dartLabel}>{item ? formatThrowLabel(item) : '—'}</Text>
                <Text style={styles.dartScore}>{item ? item.score : ''}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.actionGroup}>
        {status === 'gameOver' ? (
          <>
            <PrimaryButton label="再来一局" onPress={playAgain} disabled={isBusy} />
            {undoButton}
            <SecondaryButton label="返回主页" onPress={exitGame} disabled={isBusy} />
          </>
        ) : status === 'roundInProgress' ? (
          <PrimaryButton
            label={runningAction === 'stop' ? '正在结束…' : '结束本轮'}
            onPress={() => runAction('stop', stopLiveRound)}
            disabled={isBusy}
          />
        ) : status === 'showingResult' ? (
          <>
            <PrimaryButton
              label={runningAction === 'confirm' ? '正在确认…' : '确认'}
              onPress={() => runAction('confirm', confirmCurrentRound)}
              disabled={isBusy || currentThrows.length === 0}
            />
            {reopenedRound ? (
              <SecondaryButton
                label="重投本轮"
                onPress={discardReopenedRound}
                disabled={isBusy}
              />
            ) : (
              <SecondaryButton
                label={runningAction === 'redetect' ? '正在重新识别…' : '重新识别'}
                onPress={() => runAction('redetect', redetectCurrentRound)}
                disabled={isBusy || !canRedetect || !device}
              />
            )}
          </>
        ) : (
          <>
            <PrimaryButton
              label={runningAction === 'start' ? '正在启动…' : '开始本轮'}
              onPress={startRound}
              disabled={isBusy || !cameraPermissionGranted || !device || !previewReady}
            />
            {undoButton}
          </>
        )}
        {status !== 'gameOver' ? (
          <Pressable
            onPress={confirmExit}
            disabled={isBusy || status === 'roundInProgress'}
            style={styles.exitButton}>
            <Text style={styles.exitLabel}>退出对局</Text>
          </Pressable>
        ) : null}
      </View>

      {showDebugInfo ? (
        <Panel>
          <Text style={styles.panelTitle}>调试信息</Text>
          <Text style={styles.debugText}>{statusMessage}</Text>
          {lastNativeError ? (
            <Text style={styles.debugText}>原生错误：{lastNativeError}</Text>
          ) : null}
          <Text style={styles.debugText}>{cameraStatus.statusMessage}</Text>
          <Text style={styles.debugText}>
            {status} · Zoom {cameraStatus.zoomRatio.toFixed(2)}x · {cameraStatus.lockPhase} ·{' '}
            {isRealBullTrackNativeBridgeAvailable ? 'native' : 'mock'} · 调试图 {artifactCount}
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
              label="刷新调试图"
              onPress={() => runAction('reload', reloadDebugArtifacts)}
              disabled={isBusy}
            />
            <SecondaryButton
              label="查看调试图"
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
        title="正在识别"
        message="请先点「结束本轮」，再退出对局。"
        confirmLabel="知道了"
        onConfirm={closeLeaveDialog}
        onCancel={closeLeaveDialog}
      />
      <ConfirmDialog
        visible={leaveDialog === 'confirm'}
        title="退出对局"
        message="未完成的对局不会保存。"
        confirmLabel="退出"
        cancelLabel="取消"
        danger
        onConfirm={confirmLeaveDialog}
        onCancel={closeLeaveDialog}
      />
    </ScrollView>
  );
};

const formatThrowLabel = (throwResult: ThrowResult) => {
  switch (throwResult.ring) {
    case 'innerBull':
      return '内牛';
    case 'outerBull':
      return '外牛';
    case 'miss':
      return '脱靶';
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
    height: PREVIEW_HEIGHT,
  },
  preview: {
    width: '100%',
    height: PREVIEW_HEIGHT,
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
  hidden: {
    opacity: 0,
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
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
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
