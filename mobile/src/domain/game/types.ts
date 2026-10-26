export type GameType =
  | 'highScore'
  | 'darts99'
  | 'aroundTheClock'
  | 'game301'
  | 'game501'
  | 'game701'
  | 'cricket'
  | 'cricketNoScore'
  | 'tactics'
  | 'cutThroat'
  | 'shanghai'
  | 'halfIt'
  | 'bermuda'
  | 'killer'
  | 'gotcha301';

export type GameStatus =
  | 'idle'
  | 'modeSelected'
  | 'playerSetup'
  | 'waitingForThrow'
  | 'roundInProgress'
  | 'showingResult'
  | 'gameOver';

export type RoundStatus = 'idle' | 'ready' | 'capturing' | 'resultReady' | 'error';

export type CameraLockPhase = 'IDLE' | 'METERING' | 'LOCKED' | 'FALLBACK';

export interface ThrowResult {
  id: string;
  label: string;
  score: number;
  ring:
    | 'single'
    | 'double'
    | 'triple'
    | 'outerBull'
    | 'innerBull'
    | 'miss';
  pointNorm: {
    x: number;
    y: number;
  };
  // Detection is unsure about this dart; its board marker shows ? until the player moves it.
  needsCheck?: boolean;
}

export interface PlayerSummary {
  id: string;
  name: string;
  score: number;
  roundScores: number[];
  marks?: Record<string, number>;
  // Set for players of a team game (0 = A 队).
  teamIndex?: number;
  // Killer only.
  killer?: KillerState;
}

export interface KillerState {
  // The side's own number (1-20); its doubles are what the others aim at.
  number: number;
  lives: number;
  isKiller: boolean;
}

export interface ScoreBoard {
  players: PlayerSummary[];
}

export interface RoundResult {
  playerId: string;
  playerName: string;
  throws: ThrowResult[];
  roundScore: number;
}

export interface CameraStatus {
  isReady: boolean;
  isPreviewBound: boolean;
  zoomRatio: number;
  statusMessage: string;
  lockPhase: CameraLockPhase;
  lockReason?: string | null;
}
