import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
  startLiveRound,
  stopLiveRound,
} from '../../application/services/liveRoundService';
import { useGameStore } from '../../application/stores/gameStore';
import { useVisionDebugStore } from '../../application/stores/visionDebugStore';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusCard } from '../components/StatusCard';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { isRealBullTrackNativeBridgeAvailable } from '../../native-bridge/bulltrack/bullTrackNative';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const toneForStatus = (status: string) => {
  switch (status) {
    case 'gameOver':
      return 'success' as const;
    case 'showingResult':
      return 'warning' as const;
    case 'roundInProgress':
      return 'info' as const;
    default:
      return 'default' as const;
  }
};

const normalizePhotoPath = (path: string) =>
  path.startsWith('file://') ? path : `file://${path}`;

export const GameScreen = ({ navigation }: Props) => {
  const [runningAction, setRunningAction] = useState<
    'permission' | 'prepare' | 'start' | 'stop' | 'redetect' | 'confirm' | 'reload' | null
  >(null);
  const [previewDiagnosticsText, setPreviewDiagnosticsText] = useState('vision-camera');
  const [previewReady, setPreviewReady] = useState(false);
  const cameraRef = useRef<Camera>(null);
  const isFocused = useIsFocused();
  const device = useCameraDevice('back');

  const {
    status,
    selectedMode,
    players,
    currentPlayerId,
    scoreBoard,
    currentRoundNumber,
    currentThrowNumber,
    currentThrows,
    currentRoundResult,
    winnerId,
    statusMessage,
    errorMessage,
    cameraPermissionGranted,
    cameraStatus,
    canRedetect,
    setCameraStatus,
  } = useGameStore();
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
        zoomRatio: 1,
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
        zoomRatio: 1,
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
        zoomRatio: 1,
        statusMessage: '相机已初始化，等待预览',
        lockPhase: 'IDLE',
        lockReason: null,
      });
      return;
    }

    setCameraStatus({
      isReady: true,
      isPreviewBound: true,
      zoomRatio: 1,
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

  const capturePhoto = async () => {
    const camera = cameraRef.current;
    if (!camera) {
      throw new Error('Camera reference is not ready.');
    }
    const photo = await camera.takePhoto({
      enableShutterSound: false,
    });
    return normalizePhotoPath(photo.path);
  };

  return (
    <ScrollView contentContainerStyle={styles.screenContent} style={styles.screen}>
      <View style={styles.headerBlock}>
        <SectionHeader
          eyebrow="Game"
          title="RN live round flow"
          description="第三阶段由 RN 管理整局流程；实时预览改由 VisionCamera 提供，识别继续复用原生 JNI / C++ / YOLO。"
        />
      </View>

      <View style={styles.previewSection}>
        <Text style={styles.panelTitle}>Camera Preview</Text>
        <View style={styles.previewFrame} collapsable={false}>
          {cameraPermissionGranted && device ? (
            <Camera
              ref={cameraRef}
              style={styles.preview}
              device={device}
              isActive={isFocused}
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
                  zoomRatio: 1,
                  statusMessage: `相机预览失败: ${error.message}`,
                  lockPhase: 'FALLBACK',
                  lockReason: error.code,
                });
              }}
            />
          ) : (
            <View style={styles.previewFallback}>
              <Text style={styles.body}>
                {cameraPermissionGranted ? '未找到可用的后置相机。' : '需要相机权限才能显示实时预览。'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.body}>{cameraStatus.statusMessage}</Text>
        <Text style={styles.body}>
          Zoom {cameraStatus.zoomRatio.toFixed(2)}x · {cameraStatus.lockPhase} · Preview{' '}
          {cameraStatus.isPreviewBound ? 'BOUND' : 'UNBOUND'}
        </Text>
        <Text style={styles.body}>
          Preview host: VisionCamera · Device {device?.name ?? 'missing'} ·{' '}
          {previewReady ? 'INITIALIZED' : 'PENDING'}
        </Text>
        <Text style={styles.body}>Legacy preview diagnostics: {previewDiagnosticsText}</Text>
        {cameraStatus.lockReason ? <Text style={styles.body}>{cameraStatus.lockReason}</Text> : null}
      </View>

      <View style={styles.content}>
        <View style={styles.statusGrid}>
          <StatusCard label="Mode" value={selectedMode ?? 'unselected'} />
          <StatusCard label="State" value={status} tone={toneForStatus(status)} />
          <StatusCard
            label="Round / Throw"
            value={`${currentRoundNumber} / ${currentThrowNumber}`}
          />
          <StatusCard label="Artifacts" value={`${artifactCount}`} />
        </View>

        <Panel>
          <Text style={styles.panelTitle}>Current turn</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.bodyStrong}>Current player</Text>
            <Text style={styles.body}>{currentPlayer?.name ?? '未开始'}</Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.bodyStrong}>Bridge</Text>
            <Text style={styles.body}>
              {isRealBullTrackNativeBridgeAvailable ? 'Native single-photo round' : 'Mock fallback'}
            </Text>
          </View>
          <Text style={styles.statusMessage}>{statusMessage}</Text>
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        </Panel>

        <Panel>
          <Text style={styles.panelTitle}>Scoreboard</Text>
          {(scoreBoard?.players ?? players).map(player => (
            <View key={player.id} style={styles.scoreRow}>
              <View style={styles.scoreIdentity}>
                <Text style={styles.bodyStrong}>{player.name}</Text>
                <Text style={styles.body}>
                  {player.roundScores.length > 0
                    ? `本局轮分: ${player.roundScores.join(' / ')}`
                    : '尚无已确认轮次'}
                </Text>
              </View>
              <Text style={styles.scoreValue}>{player.score}</Text>
            </View>
          ))}
        </Panel>

        <Panel>
          <View style={styles.rowBetween}>
            <Text style={styles.panelTitle}>Current round result</Text>
            <Text style={styles.totalScore}>{totalScore}</Text>
          </View>
          {currentThrows.length === 0 ? (
            <Text style={styles.body}>本轮还没有识别结果。</Text>
          ) : (
            currentThrows.map(item => (
              <View key={item.id} style={styles.throwRow}>
                <View>
                  <Text style={styles.bodyStrong}>{item.label}</Text>
                  <Text style={styles.body}>
                    ({item.pointNorm.x.toFixed(2)}, {item.pointNorm.y.toFixed(2)})
                  </Text>
                </View>
                <Text style={styles.throwScore}>{item.score}</Text>
              </View>
            ))
          )}
          {currentRoundResult ? (
            <Text style={styles.body}>
              已确认：{currentRoundResult.playerName} 本轮得到 {currentRoundResult.roundScore} 分
            </Text>
          ) : null}
          {winner ? <Text style={styles.winnerText}>Winner: {winner.name}</Text> : null}
        </Panel>

        <View style={styles.actionGroup}>
          <PrimaryButton
            label={runningAction === 'start' ? 'Starting Round...' : '开始本轮'}
            onPress={() => {
              setRunningAction('start');
              capturePhoto()
                .then(photoPath => startLiveRound(photoPath))
                .finally(() => {
                  setRunningAction(null);
                })
                .catch(() => undefined);
            }}
            disabled={
              isBusy ||
              !cameraPermissionGranted ||
              !device ||
              !previewReady ||
              status === 'roundInProgress' ||
              status === 'gameOver'
            }
          />
          <SecondaryButton
            label={runningAction === 'stop' ? 'Stopping...' : '结束本轮'}
            onPress={() => {
              setRunningAction('stop');
              stopLiveRound()
                .finally(() => {
                  setRunningAction(null);
                })
                .catch(() => undefined);
            }}
            disabled={isBusy || status !== 'roundInProgress'}
          />
          <SecondaryButton
            label={runningAction === 'redetect' ? 'Redetecting...' : '重新识别'}
            onPress={() => {
              setRunningAction('redetect');
              capturePhoto()
                .then(photoPath => redetectCurrentRound(photoPath))
                .finally(() => {
                  setRunningAction(null);
                })
                .catch(() => undefined);
            }}
            disabled={isBusy || !canRedetect || !device || !previewReady}
          />
          <SecondaryButton
            label={runningAction === 'confirm' ? 'Confirming...' : '确认本轮结果'}
            onPress={() => {
              setRunningAction('confirm');
              confirmCurrentRound()
                .finally(() => {
                  setRunningAction(null);
                })
                .catch(() => undefined);
            }}
            disabled={isBusy || status !== 'showingResult' || currentThrows.length === 0}
          />
          <SecondaryButton
            label={runningAction === 'reload' ? 'Reloading...' : '刷新调试图'}
            onPress={() => {
              setRunningAction('reload');
              reloadDebugArtifacts()
                .finally(() => {
                  setRunningAction(null);
                })
                .catch(() => undefined);
            }}
            disabled={isBusy}
          />
          <SecondaryButton
            label="查看调试图"
            onPress={() => navigation.navigate('Debug')}
            disabled={isBusy}
          />
          <SecondaryButton
            label="重新开始整局"
            onPress={() => {
              resetLiveGameSession();
              navigation.reset({
                index: 0,
                routes: [{ name: 'Home' }],
              });
            }}
            disabled={isBusy}
          />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    paddingBottom: 36,
  },
  headerBlock: {
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  previewSection: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 10,
  },
  content: {
    padding: 24,
    gap: 20,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  previewFrame: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#000',
    minHeight: 280,
  },
  preview: {
    width: '100%',
    height: 320,
  },
  previewFallback: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.info,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  scoreIdentity: {
    flex: 1,
    gap: 4,
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  totalScore: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.accent,
  },
  throwRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  throwScore: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  winnerText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.success,
  },
  actionGroup: {
    gap: 12,
  },
});
