import { create } from 'zustand';
import type {
  CameraStatus,
  GameStatus,
  GameType,
  PlayerSummary,
  RoundResult,
  ScoreBoard,
  ThrowResult,
} from '../../domain/game/types';
import type { CompletedRoundRecord } from '../../domain/history/types';

interface GameStoreState {
  status: GameStatus;
  selectedMode: GameType | null;
  selectedModeLabel: string | null;
  players: PlayerSummary[];
  currentPlayerId: string | null;
  scoreBoard: ScoreBoard | null;
  currentRoundNumber: number;
  currentThrowNumber: number;
  currentThrows: ThrowResult[];
  currentRoundResult: RoundResult | null;
  completedRounds: CompletedRoundRecord[];
  winnerId: string | null;
  gameStartedAt: number | null;
  statusMessage: string;
  errorMessage: string | null;
  cameraPermissionGranted: boolean;
  cameraStatus: CameraStatus;
  roundId: string | null;
  canRedetect: boolean;
  selectMode: (mode: GameType, label: string) => void;
  configurePlayers: (playerNames: string[]) => void;
  setCurrentPlayer: (playerId: string | null) => void;
  setScoreBoard: (scoreBoard: ScoreBoard | null) => void;
  setRoundState: (input: {
    roundId?: string | null;
    status?: GameStatus;
    statusMessage?: string;
    currentThrows?: ThrowResult[];
    currentThrowNumber?: number;
    canRedetect?: boolean;
    errorMessage?: string | null;
  }) => void;
  setRoundResult: (result: RoundResult) => void;
  addCompletedRound: (round: CompletedRoundRecord) => void;
  setWinner: (winnerId: string | null, statusMessage: string) => void;
  setCameraPermissionGranted: (granted: boolean) => void;
  setCameraStatus: (status: Partial<CameraStatus>) => void;
  advanceRoundCounter: () => void;
  clearRoundForNextTurn: () => void;
  resetGame: () => void;
}

const initialCameraStatus: CameraStatus = {
  isReady: false,
  isPreviewBound: false,
  zoomRatio: 1,
  statusMessage: '等待相机权限',
  lockPhase: 'IDLE',
  lockReason: null,
};

const initialState = {
  status: 'idle' as GameStatus,
  selectedMode: null as GameType | null,
  selectedModeLabel: null as string | null,
  players: [] as PlayerSummary[],
  currentPlayerId: null as string | null,
  scoreBoard: null as ScoreBoard | null,
  currentRoundNumber: 0,
  currentThrowNumber: 0,
  currentThrows: [] as ThrowResult[],
  currentRoundResult: null as RoundResult | null,
  completedRounds: [] as CompletedRoundRecord[],
  winnerId: null as string | null,
  gameStartedAt: null as number | null,
  statusMessage: '选择模式并开始新游戏',
  errorMessage: null as string | null,
  cameraPermissionGranted: false,
  cameraStatus: initialCameraStatus,
  roundId: null as string | null,
  canRedetect: false,
};

export const useGameStore = create<GameStoreState>(set => ({
  ...initialState,
  selectMode: (selectedMode, selectedModeLabel) =>
    set({
      selectedMode,
      selectedModeLabel,
      status: 'modeSelected',
      statusMessage: '已选择模式，继续设置玩家',
      errorMessage: null,
    }),
  configurePlayers: playerNames => {
    const players = playerNames.map((name, index) => ({
      id: `player-${index + 1}`,
      name: name.trim() || `Player ${index + 1}`,
      score: 0,
      roundScores: [],
    }));
    set({
      players,
      scoreBoard: { players },
      currentPlayerId: players[0]?.id ?? null,
      currentRoundNumber: 1,
      currentThrowNumber: 0,
      currentThrows: [],
      currentRoundResult: null,
      completedRounds: [],
      winnerId: null,
      gameStartedAt: Date.now(),
      status: 'waitingForThrow',
      statusMessage: '准备开始第一轮',
      errorMessage: null,
    });
  },
  setCurrentPlayer: currentPlayerId => set({ currentPlayerId }),
  setScoreBoard: scoreBoard => set({ scoreBoard }),
  setRoundState: input =>
    set(state => ({
      roundId:
        input.roundId === undefined ? state.roundId : (input.roundId ?? null),
      status: input.status ?? state.status,
      statusMessage: input.statusMessage ?? state.statusMessage,
      currentThrows: input.currentThrows ?? state.currentThrows,
      currentThrowNumber:
        input.currentThrowNumber ?? input.currentThrows?.length ?? state.currentThrowNumber,
      canRedetect: input.canRedetect ?? state.canRedetect,
      currentRoundResult:
        input.status === 'roundInProgress' ? null : state.currentRoundResult,
      errorMessage:
        input.errorMessage === undefined ? state.errorMessage : input.errorMessage,
    })),
  setRoundResult: result =>
    set({
      currentRoundResult: result,
      currentThrows: result.throws,
      currentThrowNumber: result.throws.length,
      status: 'showingResult',
      canRedetect: false,
      errorMessage: null,
      statusMessage: '本轮结果已确认',
    }),
  addCompletedRound: round =>
    set(state => ({
      completedRounds: [...state.completedRounds, round],
    })),
  setWinner: (winnerId, statusMessage) =>
    set({
      winnerId,
      status: 'gameOver',
      statusMessage,
      canRedetect: false,
    }),
  setCameraPermissionGranted: cameraPermissionGranted =>
    set(state => ({
      cameraPermissionGranted,
      cameraStatus: cameraPermissionGranted
        ? state.cameraStatus
        : {
            ...state.cameraStatus,
            isReady: false,
            statusMessage: '需要相机权限才能开始本轮',
          },
    })),
  setCameraStatus: status =>
    set(state => ({
      cameraStatus: {
        ...state.cameraStatus,
        ...status,
      },
    })),
  advanceRoundCounter: () =>
    set(state => ({
      currentRoundNumber: state.currentRoundNumber + 1,
    })),
  clearRoundForNextTurn: () =>
    set({
      roundId: null,
      currentThrows: [],
      currentThrowNumber: 0,
      currentRoundResult: null,
      canRedetect: false,
      errorMessage: null,
      status: 'waitingForThrow',
      statusMessage: '准备开始下一轮',
    }),
  resetGame: () => set(initialState),
}));
