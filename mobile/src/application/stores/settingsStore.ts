import { create } from 'zustand';
import { getSetting, setSetting } from '../services/historyRepository';

const SHOW_DEBUG_KEY = 'showDebugInfo';

interface SettingsStoreState {
  loaded: boolean;
  showDebugInfo: boolean;
  loadSettings: () => Promise<void>;
  setShowDebugInfo: (value: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  loaded: false,
  showDebugInfo: false,
  loadSettings: async () => {
    if (get().loaded) {
      return;
    }
    try {
      const showDebugInfo = (await getSetting(SHOW_DEBUG_KEY)) === '1';
      set({ loaded: true, showDebugInfo });
    } catch {
      set({ loaded: true });
    }
  },
  setShowDebugInfo: async value => {
    set({ showDebugInfo: value });
    await setSetting(SHOW_DEBUG_KEY, value ? '1' : '0');
  },
}));
