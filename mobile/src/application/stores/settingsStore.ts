import { create } from 'zustand';
import { getSetting, setSetting } from '../services/historyRepository';

const SHOW_DEBUG_KEY = 'showDebugInfo';
const ZOOM_RATIO_KEY = 'zoomRatio';
const SOUND_CUES_KEY = 'soundCues';
const VIBRATION_KEY = 'vibration';

interface SettingsStoreState {
  loaded: boolean;
  showDebugInfo: boolean;
  // Last camera zoom the player chose; reused when the next game opens the camera.
  zoomRatio: number;
  // Knock sounds for a player at the board; on unless turned off.
  soundCues: boolean;
  // Light tick while dragging a dart marker into a new region; on unless turned off.
  vibration: boolean;
  // Developer recording of raw round frames. Not stored, so it is off after a restart and
  // cannot be left on by mistake; it also goes off with the debug info it sits under.
  recordFrames: boolean;
  // Developer switch: run YOLO on the CPU instead of the GPU, to compare speed and power. Not
  // stored, and off with the debug info, like recordFrames.
  yoloOnCpu: boolean;
  loadSettings: () => Promise<void>;
  setShowDebugInfo: (value: boolean) => Promise<void>;
  setRecordFrames: (value: boolean) => void;
  setYoloOnCpu: (value: boolean) => void;
  setZoomRatio: (value: number) => Promise<void>;
  setSoundCues: (value: boolean) => Promise<void>;
  setVibration: (value: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  loaded: false,
  showDebugInfo: false,
  zoomRatio: 1,
  soundCues: true,
  vibration: true,
  recordFrames: false,
  yoloOnCpu: false,
  loadSettings: async () => {
    if (get().loaded) {
      return;
    }
    try {
      const showDebugInfo = (await getSetting(SHOW_DEBUG_KEY)) === '1';
      const storedZoom = Number(await getSetting(ZOOM_RATIO_KEY));
      const soundCues = (await getSetting(SOUND_CUES_KEY)) !== '0';
      const vibration = (await getSetting(VIBRATION_KEY)) !== '0';
      set({
        loaded: true,
        showDebugInfo,
        zoomRatio: Number.isFinite(storedZoom) && storedZoom >= 1 ? storedZoom : 1,
        soundCues,
        vibration,
      });
    } catch {
      set({ loaded: true });
    }
  },
  setShowDebugInfo: async value => {
    set(value ? { showDebugInfo: value } : { showDebugInfo: value, recordFrames: false, yoloOnCpu: false });
    await setSetting(SHOW_DEBUG_KEY, value ? '1' : '0');
  },
  setRecordFrames: value => set({ recordFrames: value }),
  setYoloOnCpu: value => set({ yoloOnCpu: value }),
  setZoomRatio: async value => {
    set({ zoomRatio: value });
    await setSetting(ZOOM_RATIO_KEY, value.toFixed(2));
  },
  setSoundCues: async value => {
    set({ soundCues: value });
    await setSetting(SOUND_CUES_KEY, value ? '1' : '0');
  },
  setVibration: async value => {
    set({ vibration: value });
    await setSetting(VIBRATION_KEY, value ? '1' : '0');
  },
}));
