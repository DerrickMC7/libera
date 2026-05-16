import { useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";

export function useEqualizer() {
  const {
    eqEnabled, eqBands, activePresetId,
    setEqEnabled, setEqBand, applyPreset,
  } = useSettingsStore();

  useEffect(() => {
    console.log('EQ enabled:', eqEnabled, 'bands:', eqBands.map(b => ({f: b.frequency, g: b.gain})));
  }, [eqEnabled, eqBands]);

  // Placeholder - EQ implementation will go here
  // Currently connects in useAudioPlayer via global AudioContext
}

