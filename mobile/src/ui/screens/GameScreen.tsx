import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import {
  confirmCurrentRound,
  ensureBullTrackSubscriptions,
  getPreviewDiagnostics,
  prepareLiveCamera,
  redetectCurrentRound,
  reloadDebugArtifacts,
  requestCameraPermission,
  resetLiveGameSession,
  startGameSession,
  startLiveRound,
  stopLiveRound,
  updateLiveZoomRatio,
} from '../../application/services/liveRoundService';
import { useGameStore } from '../../application/stores/gameStore';
import { useVisionDebugStore } from '../../application/stores/visionDebugStore';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { Scoreboard } from '../components/Scoreboard';
import { ThrowEditor } from '../components/ThrowEditor';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { isRealBullTrackNativeBridgeAvailable } from '../../native-bridge/bulltrack/bullTrackNative';
import type { ThrowResult } from '../../domain/game/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_SLIDER_HEIGHT = 220;
const ZOOM_THUMB_SIZE = 26;

export const GameScreen = ({ navigation }: Props) => {
  const [runningAction, setRunningAction] = useState<
    'permission' | 'prepare' | 'start' | 'stop' | 'redetect' | 'confirm' | 'reload' | null
  >(null);
  const [previewDiagnosticsText, setPreviewDiagnosticsText] = useState('vision-camera');
  const [previewReady, setPreviewReady] = useState(false);
  const [handoffInProgress, setHandoffInProgress] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [previewInstanceKey, setPreviewInstanceKey] = useState(0);
  const [zoomTrackHeight, setZoomTrackHeight] = useState(ZOOM_SLIDER_HEIGHT);
  const [previewZoomRatio, setPreviewZoomRatio] = useState(ZOOM_MIN);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const zoomTrackRef = useRef<View>(null);
  const latestZoomRef = useRef(ZOOM_MIN);
  const isFocused = useIsFocused();
  const device = useCameraDevice('back');

  const {
    status,
    selectedMode,
    selectedModeLabel,
    players,
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
  } = useGameStore();
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const previousStatusRef = useRef(status);
  const isZoomDraggingRef = useRef(false);
  const zoomTrackTopRef = useRef(0);
  const zoomDragOffsetRef = useRef(0);
  const artifactCount = useVisionDebugStore(state => state.artifacts.length);

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
      .then(() => getPreviewDiagnostics())
      .then(diagnostics => {
        setPreviewDiagnosticsText(JSON.stringify(diagnostics));
      })
      .finally(() => {
        setRunningAction(null);
      });
  }, []);

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

  const currentPlayer = useMemo(
    () => players.find(player => player.id === currentPlayerId) ?? null,
    [currentPlayerId, players],
  );
  const winner = useMemo(
    () => players.find(player => player.id === winnerId) ?? null,
    [players, winnerId],
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

  useEffect(() => {
    const clamped = Math.min(zoomRange.max, Math.max(zoomRange.min, cameraStatus.zoomRatio || ZOOM_MIN));
    if (isZoomDraggingRef.current) {
      return;
    }
    setPreviewZoomRatio(clamped);
    latestZoomRef.current = clamped;
  }, [cameraStatus.zoomRatio, zoomRange.max, zoomRange.min]);

  useEffect(() => {
    if (status !== 'waitingForThrow') {
      setHandoffInProgress(false);
    }
  }, [status]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    if (status === 'waitingForThrow' && previousStatus !== 'waitingForThrow') {
      setPreviewReady(false);
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
  };

  const refreshZoomTrackMetrics = () => {
    zoomTrackRef.current?.measureInWindow((_x, y, _width, height) => {
      zoomTrackTopRef.current = y;
      const nextHeight = Math.round(height);
      if (nextHeight > 0) {
        setZoomTrackHeight(current => (current === nextHeight ? current : nextHeight));
      }
    });
  };

  const resolveZoomRatioFromPageY = (pageY: number) => {
    const trackHeight = Math.max(1, zoomTrackHeight);
    const relativeY = pageY - zoomTrackTopRef.current - zoomDragOffsetRef.current;
    const progress = 1 - Math.min(1, Math.max(0, relativeY / trackHeight));
    return zoomRange.min + progress * (zoomRange.max - zoomRange.min);
  };

  const beginZoomDrag = (locationY: number, pageY: number) => {
    if (!canAdjustZoom) {
      return;
    }
    isZoomDraggingRef.current = true;
    setScrollEnabled(false);
    refreshZoomTrackMetrics();
    const trackHeight = Math.max(1, zoomTrackHeight);
    const usableHeight = Math.max(1, trackHeight - ZOOM_THUMB_SIZE);
    const zoomSpan = Math.max(0.0001, zoomRange.max - zoomRange.min);
    const normalized = (previewZoomRatio - zoomRange.min) / zoomSpan;
    const thumbTop = (1 - normalized) * usableHeight;
    const thumbCenter = thumbTop + ZOOM_THUMB_SIZE / 2;
    zoomDragOffsetRef.current = locationY - thumbCenter;
    commitZoomRatio(resolveZoomRatioFromPageY(pageY));
  };

  const moveZoomDrag = (pageY: number) => {
    if (!canAdjustZoom) {
      return;
    }
    commitZoomRatio(resolveZoomRatioFromPageY(pageY));
  };

  const endZoomDrag = () => {
    isZoomDraggingRef.current = false;
    zoomDragOffsetRef.current = 0;
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
    );
  };

  const exitGame = () => {
    resetLiveGameSession();
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  };

  const confirmExit = () => {
    Alert.alert('退出对局', '未完成的对局不会保存。', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: exitGame },
    ]);
  };

  const canEditThrows = status === 'showingResult' && !isBusy;
  const turnHeadline =
    status === 'gameOver'
      ? `${winner?.name ?? '比赛'} 获胜`
      : status === 'roundInProgress'
        ? captureReady
          ? `请投镖 · 已识别 ${currentThrowNumber} 镖`
          : '准备中，先别投镖'
        : status === 'showingResult'
          ? '确认本轮结果'
          : `轮到 ${currentPlayer?.name ?? '玩家'} · 第 ${currentRoundNumber} 轮`;
  const turnHint =
    status === 'showingResult'
      ? '识别不对可以点飞镖修改'
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
      />

      <View style={styles.previewFrame} collapsable={false}>
        {cameraPermissionGranted && device ? (
          <Camera
            key={`preview-${previewInstanceKey}`}
            style={styles.preview}
            device={device}
            isActive={shouldShowVisionPreview}
            zoom={previewZoomRatio}
            photo
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
          </View>
        )}
        {!shouldShowVisionPreview && cameraPermissionGranted && device ? (
          <View style={styles.previewCover} pointerEvents="none">
            <Text style={styles.coverTitle}>
              {status === 'roundInProgress'
                ? captureReady
                  ? '可以投镖了'
                  : '准备中…'
                : status === 'gameOver'
                  ? '比赛结束'
                  : '本轮已结束'}
            </Text>
            {status === 'roundInProgress' ? (
              <Text style={styles.coverHint}>识别期间暂停预览以省电</Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.zoomOverlay} pointerEvents="box-none">
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
              beginZoomDrag(event.nativeEvent.locationY, event.nativeEvent.pageY);
            }}
            onResponderMove={event => {
              moveZoomDrag(event.nativeEvent.pageY);
            }}
            onResponderRelease={endZoomDrag}
            onResponderTerminate={endZoomDrag}
          >
            <Text style={styles.zoomScaleLabel}>{zoomRange.max.toFixed(1)}x</Text>
            <View
              ref={zoomTrackRef}
              style={styles.zoomTrack}
              onLayout={event => {
                const nextHeight = Math.round(event.nativeEvent.layout.height);
                setZoomTrackHeight(current => (current === nextHeight ? current : nextHeight));
                refreshZoomTrackMetrics();
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
            <PrimaryButton label="再来一局" onPress={playAgain} />
            <SecondaryButton label="返回主页" onPress={exitGame} />
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
            <SecondaryButton
              label={runningAction === 'redetect' ? '正在重新识别…' : '重新识别'}
              onPress={() => runAction('redetect', redetectCurrentRound)}
              disabled={isBusy || !canRedetect || !device}
            />
          </>
        ) : (
          <PrimaryButton
            label={runningAction === 'start' ? '正在启动…' : '开始本轮'}
            onPress={startRound}
            disabled={isBusy || !cameraPermissionGranted || !device || !previewReady}
          />
        )}
        {status !== 'gameOver' ? (
          <Pressable onPress={confirmExit} disabled={isBusy} style={styles.exitButton}>
            <Text style={styles.exitLabel}>退出对局</Text>
          </Pressable>
        ) : null}
      </View>

      {showDebugInfo ? (
        <Panel>
          <Text style={styles.panelTitle}>调试信息</Text>
          <Text style={styles.debugText}>{statusMessage}</Text>
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
          <Text style={styles.debugText}>{previewDiagnosticsText}</Text>
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
    height: 320,
  },
  preview: {
    width: '100%',
    height: 320,
  },
  previewCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  fallbackText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F7F8FA',
  },
  coverTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F7F8FA',
  },
  coverHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#D7DBE2',
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
    borderStyle: 'dashed',
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
