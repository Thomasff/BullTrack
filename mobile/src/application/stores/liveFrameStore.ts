import { create } from 'zustand';

// Latest near-live frame of the running round. Kept apart from gameStore so a
// new frame (about 3 per second) only re-renders the snapshot view.
interface LiveFrameStoreState {
  roundId: string | null;
  uri: string | null;
  setFrame: (roundId: string, uri: string) => void;
  clear: () => void;
}

export const useLiveFrameStore = create<LiveFrameStoreState>(set => ({
  roundId: null,
  uri: null,
  setFrame: (roundId, uri) => set({ roundId, uri }),
  clear: () => set({ roundId: null, uri: null }),
}));
