export type GameMode = 'highScore' | 'x01' | 'cricket';

export type RoundStatus =
  | 'idle'
  | 'ready'
  | 'capturing'
  | 'resultReady'
  | 'error';

export interface ThrowResult {
  id: string;
  label: string;
  score: number;
  ring: 'single' | 'double' | 'triple' | 'miss';
  pointNorm: {
    x: number;
    y: number;
  };
}

export interface PlayerSummary {
  id: string;
  name: string;
  score: number;
}
