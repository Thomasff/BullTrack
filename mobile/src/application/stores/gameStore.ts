import { create } from 'zustand';
import type { GameMode, PlayerSummary } from '../../domain/game/types';

interface GameStoreState {
  selectedMode: GameMode;
  players: PlayerSummary[];
  setSelectedMode: (mode: GameMode) => void;
  resetDemo: () => void;
}

const defaultPlayers: PlayerSummary[] = [
  { id: 'player-1', name: 'Player 1', score: 0 },
  { id: 'player-2', name: 'Player 2', score: 0 },
];

export const useGameStore = create<GameStoreState>(set => ({
  selectedMode: 'highScore',
  players: defaultPlayers,
  setSelectedMode: selectedMode => set({ selectedMode }),
  resetDemo: () =>
    set({
      selectedMode: 'highScore',
      players: defaultPlayers,
    }),
}));
