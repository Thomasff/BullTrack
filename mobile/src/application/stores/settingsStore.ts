import { create } from 'zustand';
import { getSetting, setSetting } from '../services/historyRepository';

const SHOW_DEBUG_KEY = 'showDebugInfo';
const ZOOM_RATIO_KEY = 'zoomRatio';
const SOUND_CUES_KEY = 'soundCues';

interface SettingsStoreState {
  loaded: boolean;
  showDebugInfo: boolean;
  // Last camera zoom the player chose; reused when the next game opens the camera.
  zoomRatio: number;
  // Knock sounds for a player at the board; on unless turned off.
  soundCues: boolean;
  // Developer recording of raw round frames. Not stored, so it is off after a restart and
  // cannot be left on by mistake; it also goes off with the debug info it sits under.
  recordFrames: boolean;
  loadSettings: () => Promise<void>;
  setShowDebugInfo: (value: boolean) => Promise<void>;
  setRecordFrames: (value: boolean) => void;
  setZoomRatio: (value: number) => Promise<void>;
  setSoundCues: (value: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  loaded: false,
  showDebugInfo: false,
  zoomRatio: 1,
  soundCues: true,
  recordFrames: false,
  loadSettings: async () => {
    if (get().loaded) {
      return;
    }
    try {
      const showDebugInfo = (await getSetting(SHOW_DEBUG_KEY)) === '1';
      const storedZoom = Number(await getSetting(ZOOM_RATIO_KEY));
      const soundCues = (await getSetting(SOUND_CUES_KEY)) !== '0';
      set({
        loaded: true,
        showDebugInfo,
        zoomRatio: Number.isFinite(storedZoom) && storedZoom >= 1 ? storedZoom : 1,
        soundCues,
      });
    } catch {
      set({ loaded: true });
    }
  },
  setShowDebugInfo: async value => {
    set(value ? { showDebugInfo: value } : { showDebugInfo: value, recordFrames: false });
    await setSetting(SHOW_DEBUG_KEY, value ? '1' : '0');
  },
  setRecordFrames: value => set({ recordFrames: value }),
  setZoomRatio: async value => {
    set({ zoomRatio: value });
    await setSetting(ZOOM_RATIO_KEY, value.toFixed(2));
  },
  setSoundCues: async value => {
    set({ soundCues: value });
    await setSetting(SOUND_CUES_KEY, value ? '1' : '0');
  },
}));
