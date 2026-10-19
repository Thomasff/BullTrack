import { create } from 'zustand';
import type { DebugArtifact } from '../../domain/vision/types';

interface VisionDebugStoreState {
  artifacts: DebugArtifact[];
  lastNativeError: string | null;
  setArtifacts: (artifacts: DebugArtifact[]) => void;
  clearArtifacts: () => void;
  setLastNativeError: (message: string | null) => void;
}

export const useVisionDebugStore = create<VisionDebugStoreState>(set => ({
  artifacts: [],
  lastNativeError: null,
  setArtifacts: artifacts => set({ artifacts }),
  clearArtifacts: () => set({ artifacts: [], lastNativeError: null }),
  setLastNativeError: lastNativeError => set({ lastNativeError }),
}));
