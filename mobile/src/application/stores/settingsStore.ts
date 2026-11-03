import { create } from 'zustand';
import { getSetting, setSetting } from '../services/historyRepository';
import { bullTrackNativeBridge } from '../../native-bridge/bulltrack/bullTrackNative';
import { changeLanguage, type AppLanguage, type LanguageChoice } from '../../i18n';

const DEVELOPER_MODE_KEY = 'developerMode';
const SHOW_DEBUG_KEY = 'showDebugInfo';
const ZOOM_RATIO_KEY = 'zoomRatio';
const SOUND_CUES_KEY = 'soundCues';
const VIBRATION_KEY = 'vibration';
const BOARD_KIND_KEY = 'boardKind';
const SHARE_SHOW_URL_KEY = 'shareShowUrl';
const SHARE_OPTIONS_KEY = 'shareOptions';
const SELF_MOCKING_KEY = 'highlightSelfMocking';
const LANGUAGE_KEY = 'language';
const PLACEMENT_GUIDE_SEEN_KEY = 'placementGuideSeen';

// Steel-tip boards have red and green beds, soft-tip boards red and blue ones.
export type BoardKind = 'steel' | 'soft';

// Share card choices made on the preview page; remembered there, not shown in settings. The card
// language is not among them: it starts as the app language on every share.
export interface ShareOptions {
  // 'portrait' is 1080×1350 (4:5), 'story' 1080×1920 (9:16).
  size: 'portrait' | 'story';
  // Off draws "玩家 1" / "Player 1" instead of every player's name.
  showNames: boolean;
  // Round cards: 'auto' takes the close-up for darts grouped together, else the round board.
  photo: 'auto' | 'full' | 'close' | 'none';
}

// What a card is drawn with: the remembered choices plus this share's language.
export type CardOptions = ShareOptions & { language: AppLanguage };

const PHOTO_CHOICES: ShareOptions['photo'][] = ['auto', 'full', 'close', 'none'];

const DEFAULT_SHARE_OPTIONS: ShareOptions = { size: 'portrait', showNames: true, photo: 'auto' };

const parseShareOptions = (text: string | null): ShareOptions => {
  try {
    const value = text ? JSON.parse(text) : {};
    return {
      size: value.size === 'story' ? 'story' : 'portrait',
      showNames: value.showNames !== false,
      photo: PHOTO_CHOICES.includes(value.photo) ? value.photo : 'auto',
    };
  } catch {
    return DEFAULT_SHARE_OPTIONS;
  }
};

interface SettingsStoreState {
  loaded: boolean;
  // App language; 'system' (the default) follows the phone.
  language: LanguageChoice;
  // Unlocked by tapping the version line on the settings page; shows the developer switches
  // there and stays on across restarts. Only the player turns it off, on the settings page.
  developerMode: boolean;
  showDebugInfo: boolean;
  // Last camera zoom the player chose; reused when the next game opens the camera.
  zoomRatio: number;
  // Knock sounds for a player at the board; on unless turned off.
  soundCues: boolean;
  // Light tick while dragging a dart marker into a new region; on unless turned off.
  vibration: boolean;
  // The player's board: the virtual board's colours and how far past the measured colour edges
  // the scoring rings reach. Steel until chosen.
  boardKind: BoardKind;
  // Whether the player has chosen the board yet; the first launch asks.
  boardKindChosen: boolean;
  // Developer recording of raw round frames. Not stored, so it is off after a restart and
  // cannot be left on by mistake; it also goes off with developer mode.
  recordFrames: boolean;
  // Developer switch: run YOLO on the CPU instead of the GPU, to compare speed and power. Not
  // stored, and off with developer mode, like recordFrames.
  yoloOnCpu: boolean;
  // Share cards always carry the BullTrack name; this adds the line with the project address.
  shareShowUrl: boolean;
  shareOptions: ShareOptions;
  // Self-mocking highlights (26 = 20, 5 and 1) also get the red label; off unless turned on.
  highlightSelfMocking: boolean;
  // The placement guide opens by itself the first time the game screen is ready, then only on request.
  placementGuideSeen: boolean;
  loadSettings: () => Promise<void>;
  setDeveloperMode: (value: boolean) => Promise<void>;
  setShowDebugInfo: (value: boolean) => Promise<void>;
  setRecordFrames: (value: boolean) => void;
  setYoloOnCpu: (value: boolean) => void;
  setZoomRatio: (value: number) => Promise<void>;
  setSoundCues: (value: boolean) => Promise<void>;
  setVibration: (value: boolean) => Promise<void>;
  setBoardKind: (value: BoardKind) => Promise<void>;
  setShareShowUrl: (value: boolean) => Promise<void>;
  setShareOptions: (value: Partial<ShareOptions>) => Promise<void>;
  setHighlightSelfMocking: (value: boolean) => Promise<void>;
  setLanguage: (value: LanguageChoice) => Promise<void>;
  setPlacementGuideSeen: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  loaded: false,
  language: 'system',
  developerMode: false,
  showDebugInfo: false,
  zoomRatio: 1,
  soundCues: true,
  vibration: true,
  boardKind: 'steel',
  boardKindChosen: false,
  recordFrames: false,
  yoloOnCpu: false,
  shareShowUrl: true,
  shareOptions: DEFAULT_SHARE_OPTIONS,
  highlightSelfMocking: false,
  placementGuideSeen: false,
  loadSettings: async () => {
    if (get().loaded) {
      return;
    }
    try {
      const developerMode = (await getSetting(DEVELOPER_MODE_KEY)) === '1';
      const showDebugInfo = developerMode && (await getSetting(SHOW_DEBUG_KEY)) === '1';
      const storedZoom = Number(await getSetting(ZOOM_RATIO_KEY));
      const soundCues = (await getSetting(SOUND_CUES_KEY)) !== '0';
      const vibration = (await getSetting(VIBRATION_KEY)) !== '0';
      const boardKind = await getSetting(BOARD_KIND_KEY);
      const shareShowUrl = (await getSetting(SHARE_SHOW_URL_KEY)) !== '0';
      const shareOptions = parseShareOptions(await getSetting(SHARE_OPTIONS_KEY));
      const highlightSelfMocking = (await getSetting(SELF_MOCKING_KEY)) === '1';
      const placementGuideSeen = (await getSetting(PLACEMENT_GUIDE_SEEN_KEY)) === '1';
      const storedLanguage = await getSetting(LANGUAGE_KEY);
      const language: LanguageChoice =
        storedLanguage === 'zh' || storedLanguage === 'en' ? storedLanguage : 'system';
      await changeLanguage(language);
      set({
        loaded: true,
        language,
        developerMode,
        showDebugInfo,
        zoomRatio: Number.isFinite(storedZoom) && storedZoom >= 1 ? storedZoom : 1,
        soundCues,
        vibration,
        boardKind: boardKind === 'soft' ? 'soft' : 'steel',
        boardKindChosen: boardKind === 'soft' || boardKind === 'steel',
        shareShowUrl,
        shareOptions,
        highlightSelfMocking,
        placementGuideSeen,
      });
    } catch {
      set({ loaded: true });
    }
  },
  setDeveloperMode: async value => {
    // Turning it off puts every developer switch back to its default.
    set(
      value
        ? { developerMode: true }
        : { developerMode: false, showDebugInfo: false, recordFrames: false, yoloOnCpu: false },
    );
    await setSetting(DEVELOPER_MODE_KEY, value ? '1' : '0');
    if (!value) {
      await setSetting(SHOW_DEBUG_KEY, '0');
      // Debug images, round logs and recorded frames are only kept while developer mode is on.
      await bullTrackNativeBridge.deleteDebugFiles();
    }
  },
  setShowDebugInfo: async value => {
    set({ showDebugInfo: value });
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
  setBoardKind: async value => {
    set({ boardKind: value, boardKindChosen: true });
    await setSetting(BOARD_KIND_KEY, value);
  },
  setShareShowUrl: async value => {
    set({ shareShowUrl: value });
    await setSetting(SHARE_SHOW_URL_KEY, value ? '1' : '0');
  },
  setShareOptions: async value => {
    const shareOptions = { ...get().shareOptions, ...value };
    set({ shareOptions });
    await setSetting(SHARE_OPTIONS_KEY, JSON.stringify(shareOptions));
  },
  setHighlightSelfMocking: async value => {
    set({ highlightSelfMocking: value });
    await setSetting(SELF_MOCKING_KEY, value ? '1' : '0');
  },
  setLanguage: async value => {
    set({ language: value });
    await changeLanguage(value);
    await setSetting(LANGUAGE_KEY, value);
  },
  setPlacementGuideSeen: async () => {
    set({ placementGuideSeen: true });
    await setSetting(PLACEMENT_GUIDE_SEEN_KEY, '1');
  },
}));
