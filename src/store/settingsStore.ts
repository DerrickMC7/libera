import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface EqBand {
  frequency: number;
  gain: number;
}

export interface EqPreset {
  id: string;
  name: string;
  bands: EqBand[];
  isBuiltIn?: boolean;
}

const DEFAULT_BANDS: EqBand[] = [
  { frequency: 32, gain: 0 },
  { frequency: 64, gain: 0 },
  { frequency: 125, gain: 0 },
  { frequency: 250, gain: 0 },
  { frequency: 500, gain: 0 },
  { frequency: 1000, gain: 0 },
  { frequency: 2000, gain: 0 },
  { frequency: 4000, gain: 0 },
  { frequency: 8000, gain: 0 },
  { frequency: 16000, gain: 0 },
];

const BUILT_IN_PRESETS: EqPreset[] = [
  { id: "flat", name: "Flat", isBuiltIn: true, bands: DEFAULT_BANDS },
  { id: "bass-boost", name: "Bass Boost", isBuiltIn: true, bands: [
    { frequency: 32, gain: 8 }, { frequency: 64, gain: 7 },
    { frequency: 125, gain: 5 }, { frequency: 250, gain: 2 },
    { frequency: 500, gain: 0 }, { frequency: 1000, gain: 0 },
    { frequency: 2000, gain: 0 }, { frequency: 4000, gain: 0 },
    { frequency: 8000, gain: 0 }, { frequency: 16000, gain: 0 },
  ]},
  { id: "rock", name: "Rock", isBuiltIn: true, bands: [
    { frequency: 32, gain: 4 }, { frequency: 64, gain: 3 },
    { frequency: 125, gain: 2 }, { frequency: 250, gain: 0 },
    { frequency: 500, gain: -1 }, { frequency: 1000, gain: 0 },
    { frequency: 2000, gain: 2 }, { frequency: 4000, gain: 3 },
    { frequency: 8000, gain: 4 }, { frequency: 16000, gain: 3 },
  ]},
  { id: "jazz", name: "Jazz", isBuiltIn: true, bands: [
    { frequency: 32, gain: 3 }, { frequency: 64, gain: 2 },
    { frequency: 125, gain: 1 }, { frequency: 250, gain: 2 },
    { frequency: 500, gain: -1 }, { frequency: 1000, gain: -1 },
    { frequency: 2000, gain: 0 }, { frequency: 4000, gain: 2 },
    { frequency: 8000, gain: 3 }, { frequency: 16000, gain: 3 },
  ]},
  { id: "classical", name: "Classical", isBuiltIn: true, bands: [
    { frequency: 32, gain: 3 }, { frequency: 64, gain: 2 },
    { frequency: 125, gain: 1 }, { frequency: 250, gain: 0 },
    { frequency: 500, gain: 0 }, { frequency: 1000, gain: 0 },
    { frequency: 2000, gain: 0 }, { frequency: 4000, gain: -1 },
    { frequency: 8000, gain: -2 }, { frequency: 16000, gain: -3 },
  ]},
  { id: "electronic", name: "Electronic", isBuiltIn: true, bands: [
    { frequency: 32, gain: 6 }, { frequency: 64, gain: 5 },
    { frequency: 125, gain: 2 }, { frequency: 250, gain: 0 },
    { frequency: 500, gain: -1 }, { frequency: 1000, gain: 0 },
    { frequency: 2000, gain: 1 }, { frequency: 4000, gain: 3 },
    { frequency: 8000, gain: 5 }, { frequency: 16000, gain: 6 },
  ]},
  { id: "vocal", name: "Vocal", isBuiltIn: true, bands: [
    { frequency: 32, gain: -2 }, { frequency: 64, gain: -1 },
    { frequency: 125, gain: 0 }, { frequency: 250, gain: 2 },
    { frequency: 500, gain: 4 }, { frequency: 1000, gain: 5 },
    { frequency: 2000, gain: 4 }, { frequency: 4000, gain: 2 },
    { frequency: 8000, gain: 1 }, { frequency: 16000, gain: 0 },
  ]},
];

export type Theme = "dark" | "light";
export type Language = "en" | "es";
export type AccentColor = "amber" | "blue" | "green" | "purple" | "red" | "custom";

export const SHORTCUT_IDS = ["play-pause", "seek-forward", "seek-back", "now-playing", "queue", "equalizer", "mute"] as const;
export type ShortcutId = typeof SHORTCUT_IDS[number];

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  "play-pause":   "Play / Pause",
  "seek-forward": "Skip forward 5s",
  "seek-back":    "Skip back 5s",
  "now-playing":  "Open Now Playing",
  "queue":        "Open Queue",
  "equalizer":    "Open Equalizer",
  "mute":         "Toggle Mute",
};

export const DEFAULT_KEY_BINDINGS: Record<ShortcutId, string> = {
  "play-pause":   "Space",
  "seek-forward": "l",
  "seek-back":    "j",
  "now-playing":  "f",
  "queue":        "q",
  "equalizer":    "e",
  "mute":         "m",
};

export const DEFAULT_KEY_BINDINGS_2: Record<ShortcutId, string> = {
  "play-pause":   "k",
  "seek-forward": "",
  "seek-back":    "",
  "now-playing":  "",
  "queue":        "",
  "equalizer":    "",
  "mute":         "",
};

interface SettingsState {
  // Appearance
  theme: Theme;
  language: Language;
  accentColor: AccentColor;
  customAccentHex: string;
  savedCustomColors: string[];

  // Player
  autoplay: boolean;
  crossfadeDuration: number; // seconds, 0 = off
  normalizeVolume: boolean;

  // Equalizer
  eqEnabled: boolean;
  eqBands: EqBand[];
  activePresetId: string;
  customPresets: EqPreset[];

  // Advanced
  maxPagesInMemory: number;
  maxConcurrentLoads: number;
  genreMapFps: number; // target fps for the Genre Map "now playing" pulse animation

  // Actions
  keyBindings: Record<ShortcutId, string>;
  keyBindings2: Record<ShortcutId, string>;
  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Language) => void;
  setAccentColor: (color: AccentColor) => void;
  setCustomAccentHex: (hex: string) => void;
  saveCustomColor: (hex: string) => void;
  removeCustomColor: (hex: string) => void;
  setShortcut: (id: ShortcutId, key: string) => void;
  resetShortcut: (id: ShortcutId) => void;
  resetAllShortcuts: () => void;
  setShortcut2: (id: ShortcutId, key: string) => void;
  resetShortcut2: (id: ShortcutId) => void;
  resetAllShortcuts2: () => void;
  setAutoplay: (v: boolean) => void;
  setCrossfadeDuration: (v: number) => void;
  setNormalizeVolume: (v: boolean) => void;
  setEqEnabled: (v: boolean) => void;
  setEqBand: (index: number, gain: number) => void;
  setEqBands: (bands: EqBand[]) => void;
  applyPreset: (presetId: string) => void;
  saveCustomPreset: (name: string) => void;
  deleteCustomPreset: (id: string) => void;
  renameCustomPreset: (id: string, name: string) => void;
  getAllPresets: () => EqPreset[];
  setMaxPagesInMemory: (v: number) => void;
  setMaxConcurrentLoads: (v: number) => void;
  setGenreMapFps: (v: number) => void;
}

export const GENRE_MAP_FPS_OPTIONS = [24, 30, 60, 120, 240] as const;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      language: "en",
      accentColor: "amber",
      customAccentHex: "#8b5cf6",
      savedCustomColors: [],
      keyBindings: { ...DEFAULT_KEY_BINDINGS },
      keyBindings2: { ...DEFAULT_KEY_BINDINGS_2 },
      autoplay: false,
      crossfadeDuration: 0,
      normalizeVolume: false,
      eqEnabled: false,
      maxPagesInMemory: 6,
      maxConcurrentLoads: 2,
      genreMapFps: 30,
      eqBands: [...DEFAULT_BANDS],
      activePresetId: "flat",
      customPresets: [],

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setShortcut: (id, key) => set((s) => ({ keyBindings: { ...s.keyBindings, [id]: key } })),
      resetShortcut: (id) => set((s) => ({ keyBindings: { ...s.keyBindings, [id]: DEFAULT_KEY_BINDINGS[id] } })),
      resetAllShortcuts: () => set({ keyBindings: { ...DEFAULT_KEY_BINDINGS } }),
      setShortcut2: (id, key) => set((s) => ({ keyBindings2: { ...s.keyBindings2, [id]: key } })),
      resetShortcut2: (id) => set((s) => ({ keyBindings2: { ...s.keyBindings2, [id]: DEFAULT_KEY_BINDINGS_2[id] } })),
      resetAllShortcuts2: () => set({ keyBindings2: { ...DEFAULT_KEY_BINDINGS_2 } }),
      setCustomAccentHex: (hex) => set({ customAccentHex: hex, accentColor: "custom" }),
      saveCustomColor: (hex) => set((s) => {
        if (s.savedCustomColors.includes(hex) || s.savedCustomColors.length >= 7) return s;
        return { savedCustomColors: [...s.savedCustomColors, hex] };
      }),
      removeCustomColor: (hex) => set((s) => ({
        savedCustomColors: s.savedCustomColors.filter((c) => c !== hex),
      })),
      setAutoplay: (autoplay) => set({ autoplay }),
      setCrossfadeDuration: (crossfadeDuration) => set({ crossfadeDuration }),
      setNormalizeVolume: (normalizeVolume) => set({ normalizeVolume }),
      setEqEnabled: (eqEnabled) => set({ eqEnabled }),

      setEqBand: (index, gain) => {
        const bands = [...get().eqBands];
        bands[index] = { ...bands[index], gain };
        set({ eqBands: bands, activePresetId: "custom" });
      },

      setEqBands: (eqBands) => set({ eqBands }),

      applyPreset: (presetId) => {
        const all = get().getAllPresets();
        const preset = all.find((p) => p.id === presetId);
        if (preset) set({ eqBands: [...preset.bands], activePresetId: presetId });
      },

      saveCustomPreset: (name) => {
        const id = `custom-${Date.now()}`;
        const preset: EqPreset = {
          id,
          name,
          bands: [...get().eqBands],
        };
        set((s) => ({
          customPresets: [...s.customPresets, preset],
          activePresetId: id,
        }));
      },

      deleteCustomPreset: (id) => {
        set((s) => ({
          customPresets: s.customPresets.filter((p) => p.id !== id),
          activePresetId: s.activePresetId === id ? "flat" : s.activePresetId,
        }));
      },

      renameCustomPreset: (id, name) => {
        set((s) => ({
          customPresets: s.customPresets.map((p) =>
            p.id === id ? { ...p, name } : p
          ),
        }));
      },

      getAllPresets: () => {
        return [...BUILT_IN_PRESETS, ...get().customPresets];
      },

      setMaxPagesInMemory: (maxPagesInMemory) => set({ maxPagesInMemory }),
      setMaxConcurrentLoads: (maxConcurrentLoads) => set({ maxConcurrentLoads }),
      setGenreMapFps: (genreMapFps) => set({ genreMapFps }),
    }),
    {
      name: "libera-settings",
      merge: (persisted: unknown, current: SettingsState) => ({
        ...current,
        ...(persisted as Partial<SettingsState>),
        keyBindings:  { ...current.keyBindings,  ...((persisted as any)?.keyBindings  ?? {}) },
        keyBindings2: { ...current.keyBindings2, ...((persisted as any)?.keyBindings2 ?? {}) },
      }),
    }
  )
);

export { BUILT_IN_PRESETS, DEFAULT_BANDS };