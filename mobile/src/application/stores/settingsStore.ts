import { create } from 'zustand';
import { getSetting, setSetting } from '../services/historyRepository';

const SHOW_DEBUG_KEY = 'showDebugInfo';
const ZOOM_RATIO_KEY = 'zoomRatio';

interface SettingsStoreState {
  loaded: boolean;
  showDebugInfo: boolean;
  // Last camera zoom the player chose; reused when the next game opens the camera.
  zoomRatio: number;
  loadSettings: () => Promise<void>;
  setShowDebugInfo: (value: boolean) => Promise<void>;
  setZoomRatio: (value: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  loaded: false,
  showDebugInfo: false,
  zoomRatio: 1,
  loadSettings: async () => {
    if (get().loaded) {
      return;
    }
    try {
      const showDebugInfo = (await getSetting(SHOW_DEBUG_KEY)) === '1';
      const storedZoom = Number(await getSetting(ZOOM_RATIO_KEY));
      set({
        loaded: true,
        showDebugInfo,
        zoomRatio: Number.isFinite(storedZoom) && storedZoom >= 1 ? storedZoom : 1,
      });
    } catch {
      set({ loaded: true });
    }
  },
  setShowDebugInfo: async value => {
    set({ showDebugInfo: value });
    await setSetting(SHOW_DEBUG_KEY, value ? '1' : '0');
  },
  setZoomRatio: async value => {
    set({ zoomRatio: value });
    await setSetting(ZOOM_RATIO_KEY, value.toFixed(2));
  },
}));
