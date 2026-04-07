import type { GameType } from '../../domain/game/types';

export type RootStackParamList = {
  Home: undefined;
  ModeSelect: undefined;
  PlayerSetup: { gameType: GameType };
  Game: undefined;
  Debug: undefined;
};
