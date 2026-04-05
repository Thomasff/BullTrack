import { create } from 'zustand';
import type { DebugArtifact } from '../../domain/vision/types';

interface VisionDebugStoreState {
  artifacts: DebugArtifact[];
  setArtifacts: (artifacts: DebugArtifact[]) => void;
  clearArtifacts: () => void;
}

export const useVisionDebugStore = create<VisionDebugStoreState>(set => ({
  artifacts: [],
  setArtifacts: artifacts => set({ artifacts }),
  clearArtifacts: () => set({ artifacts: [] }),
}));
