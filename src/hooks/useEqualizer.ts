// EQ audio processing is handled inside useAudioPlayer (Web Audio API filter chain).
// This file is kept as a re-export for convenience if other components need EQ state.
export { useSettingsStore as useEqualizer } from "../store/settingsStore";
