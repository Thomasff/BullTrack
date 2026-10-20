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
import { getDefaultPlayerName } from '../../domain/game/players';
import {
  buildTeams,
  getEngineSides,
  getThrowerId,
  type TeamInfo,
} from '../../domain/game/teams';

// The person about to throw (in a team game, the member whose turn it is in the current team).
export const getCurrentThrowerId = (state: {
  teams: TeamInfo[] | null;
  scoreBoard: ScoreBoard | null;
  currentPlayerId: string | null;
}) => getThrowerId(state.teams, state.scoreBoard?.players ?? [], state.currentPlayerId);

interface GameStoreState {
  status: GameStatus;
  selectedMode: GameType | null;
  selectedModeLabel: string | null;
  // The people playing; in a team game each has a teamIndex.
  players: PlayerSummary[];
  // Team game only: the rule engine plays these teams as its sides (currentPlayerId is a team id).
  teams: TeamInfo[] | null;
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
  throwsEdited: boolean;
  // True once native has taken the empty-board first frame and darts may be thrown.
  captureReady: boolean;
  // The shown result is an undone round brought back for correction (no native session).
  reopenedRound: boolean;
  // History id of the saved finished game, so undoing its last round can remove it.
  savedMatchId: number | null;
  // Seed of the random parts of a game (Killer numbers), kept so undo rebuilds the same game.
  gameSeed: number;
  selectMode: (mode: GameType, label: string) => void;
  configurePlayers: (playerNames: string[], teamIndexes?: number[]) => void;
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
    captureReady?: boolean;
  }) => void;
  setRoundResult: (result: RoundResult) => void;
  replaceThrow: (index: number, throwResult: ThrowResult) => void;
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
  teams: null as TeamInfo[] | null,
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
  throwsEdited: false,
  captureReady: false,
  reopenedRound: false,
  savedMatchId: null as number | null,
  gameSeed: 0,
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
  configurePlayers: (playerNames, teamIndexes) => {
    const players: PlayerSummary[] = playerNames.map((name, index) => ({
      id: `player-${index + 1}`,
      name: name.trim() || getDefaultPlayerName(index),
      score: 0,
      roundScores: [],
      ...(teamIndexes ? { teamIndex: teamIndexes[index] ?? 0 } : {}),
    }));
    const teams = buildTeams(players);
    const sides = getEngineSides(players, teams);
    set({
      players,
      teams,
      scoreBoard: { players: sides },
      currentPlayerId: sides[0]?.id ?? null,
      currentRoundNumber: 1,
      currentThrowNumber: 0,
      currentThrows: [],
      currentRoundResult: null,
      completedRounds: [],
      winnerId: null,
      reopenedRound: false,
      savedMatchId: null,
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
      throwsEdited: input.currentThrows ? false : state.throwsEdited,
      currentThrowNumber:
        input.currentThrowNumber ?? input.currentThrows?.length ?? state.currentThrowNumber,
      canRedetect: input.canRedetect ?? state.canRedetect,
      captureReady: input.captureReady ?? state.captureReady,
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
      throwsEdited: false,
      reopenedRound: false,
    }),
  replaceThrow: (index, throwResult) =>
    set(state => ({
      currentThrows: state.currentThrows.map((item, i) =>
        i === index ? throwResult : item,
      ),
      throwsEdited: true,
    })),
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
      throwsEdited: false,
      reopenedRound: false,
      errorMessage: null,
      status: 'waitingForThrow',
      statusMessage: '准备开始下一轮',
    }),
  resetGame: () => set(initialState),
}));
