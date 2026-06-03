import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const graphReadyRef = useRef(false);

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const { currentTrack, isPlaying, volume } = usePlayerStore();
  const { eqEnabled, eqBands } = useSettingsStore();

  useEffect(() => {
    const audio = new Audio();
    // Required for createMediaElementSource — asset.localhost is cross-origin from
    // localhost:1420 in dev, so the element must request files with CORS credentials
    // or the Web Audio API will output silence even though currentTime still advances.
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => setProgress(audio.currentTime));
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration || 0));
    audio.addEventListener("ended", () => {
      const { repeat } = usePlayerStore.getState();
      if (repeat === "one") {
        audio.currentTime = 0;
        audio.play().catch(console.error);
      } else {
        usePlayerStore.getState().nextTrack();
      }
    });

    return () => {
      audio.pause();
      ctxRef.current?.close();
    };
  }, []);

  // Build the Web Audio graph lazily on first play so the AudioContext is
  // created close to a user gesture — avoids the suspended-context silence.
  function ensureGraph(audio: HTMLAudioElement) {
    if (graphReadyRef.current) return;
    graphReadyRef.current = true;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const source = ctx.createMediaElementSource(audio);
    const { eqBands: bands } = useSettingsStore.getState();

    const filters = bands.map((band) => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = band.frequency;
      f.Q.value = 1.4;
      f.gain.value = 0;
      return f;
    });
    filtersRef.current = filters;

    let node: AudioNode = source;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(ctx.destination);

    // Sync current EQ state into the freshly built graph
    const { eqEnabled, eqBands } = useSettingsStore.getState();
    eqBands.forEach((band, i) => {
      if (filters[i]) filters[i].gain.value = eqEnabled ? band.gain : 0;
    });
  }

  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;
    audioRef.current.src = convertFileSrc(currentTrack.path);
  }, [currentTrack]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      const audio = audioRef.current;
      ensureGraph(audio);
      // Always resume — calling resume() on a running context is a safe no-op
      ctxRef.current!.resume()
        .then(() => audio.play())
        .catch(console.error);
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const filters = filtersRef.current;
    if (!filters.length) return;
    eqBands.forEach((band, i) => {
      if (filters[i]) filters[i].gain.value = eqEnabled ? band.gain : 0;
    });
  }, [eqEnabled, eqBands]);

  function seek(time: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setProgress(time);
  }

  return { progress, duration, seek, audioRef };
}
