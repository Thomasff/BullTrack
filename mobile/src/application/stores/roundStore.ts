import { create } from 'zustand';
import type { RoundStatus, ThrowResult } from '../../domain/game/types';

interface RoundStoreState {
  roundId: string | null;
  status: RoundStatus;
  statusMessage: string;
  throws: ThrowResult[];
  setReady: (roundId: string, statusMessage: string) => void;
  setCapturing: (statusMessage: string) => void;
  setResult: (
    roundId: string,
    statusMessage: string,
    throws: ThrowResult[],
  ) => void;
  setError: (statusMessage: string) => void;
  reset: () => void;
}

const initialState = {
  roundId: null,
  status: 'idle' as RoundStatus,
  statusMessage:
    'React Native shell initialized. Native capture not connected yet.',
  throws: [] as ThrowResult[],
};

export const useRoundStore = create<RoundStoreState>(set => ({
  ...initialState,
  setReady: (roundId, statusMessage) =>
    set({
      roundId,
      status: 'ready',
      statusMessage,
      throws: [],
    }),
  setCapturing: statusMessage =>
    set(state => ({
      ...state,
      status: 'capturing',
      statusMessage,
    })),
  setResult: (roundId, statusMessage, throws) =>
    set({
      roundId,
      status: 'resultReady',
      statusMessage,
      throws,
    }),
  setError: statusMessage =>
    set(state => ({
      ...state,
      status: 'error',
      statusMessage,
    })),
  reset: () => set(initialState),
}));
