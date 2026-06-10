import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";

// Dual-audio crossfade architecture
// Two <audio> elements (A and B) alternate as current/next.
// Both route through their own GainNode which merge before the shared EQ chain:
//   srcA → gainA ─┐
//                  ├─ EQ filters → compressor → destination
//   srcB → gainB ─┘
// Crossfade: ramp gainA 1→0 while gainB 0→1 simultaneously.

export function useAudioPlayer() {
  const audioARef   = useRef<HTMLAudioElement | null>(null);
  const audioBRef   = useRef<HTMLAudioElement | null>(null);
  const gainARef    = useRef<GainNode | null>(null);
  const gainBRef    = useRef<GainNode | null>(null);
  const ctxRef      = useRef<AudioContext | null>(null);
  const filtersRef  = useRef<BiquadFilterNode[]>([]);
  const compRef     = useRef<DynamicsCompressorNode | null>(null);
  const graphReady  = useRef(false);
  const activeSlot  = useRef<"A" | "B">("A");
  const crossfading = useRef(false);
  const xfadeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Path currently loaded in the active audio slot.
  // The [currentTrack] effect skips the src update only when the crossfade
  // has already pre-loaded the correct track. Any mismatch (including a
  // user-initiated track change during a crossfade) aborts the crossfade
  // and loads the new path immediately.
  const loadedPathRef = useRef<string>("");

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const { currentTrack, isPlaying, volume, isMuted } = usePlayerStore();
  const { eqEnabled, eqBands, normalizeVolume } = useSettingsStore();

  // ─── Setup: create both audio elements once ──────────────────────────────
  useEffect(() => {
    const audioA = new Audio(); audioA.crossOrigin = "anonymous";
    const audioB = new Audio(); audioB.crossOrigin = "anonymous";
    audioARef.current = audioA;
    audioBRef.current = audioB;

    function attachListeners(slot: "A" | "B") {
      const audio = slot === "A" ? audioA : audioB;

      audio.addEventListener("timeupdate", () => {
        if (activeSlot.current !== slot) return;
        setProgress(audio.currentTime);

        const fade = useSettingsStore.getState().crossfadeDuration;
        if (fade <= 0 || crossfading.current || !audio.duration) return;
        const timeLeft = audio.duration - audio.currentTime;
        if (timeLeft > 0 && timeLeft <= fade) {
          triggerCrossfade(slot, fade, timeLeft);
        }
      });

      audio.addEventListener("loadedmetadata", () => {
        if (activeSlot.current !== slot) return;
        setDuration(audio.duration || 0);
      });

      audio.addEventListener("ended", () => {
        if (activeSlot.current !== slot || crossfading.current) return;
        const { repeat } = usePlayerStore.getState();
        if (repeat === "one") {
          audio.currentTime = 0;
          audio.play().catch(console.error);
        } else {
          usePlayerStore.getState().nextTrack();
        }
      });
    }

    attachListeners("A");
    attachListeners("B");

    // ─── Media keys via keydown ──────────────────────────────────────────────
    function onKeyDown(e: KeyboardEvent) {
      const store = usePlayerStore.getState();
      switch (e.key) {
        case "MediaPlayPause":     e.preventDefault(); store.setIsPlaying(!store.isPlaying); break;
        case "MediaTrackNext":     e.preventDefault(); store.nextTrack();      break;
        case "MediaTrackPrevious": e.preventDefault(); store.previousTrack();  break;
        case "MediaStop":          e.preventDefault(); store.setIsPlaying(false); break;
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      audioA.pause(); audioB.pause();
      ctxRef.current?.close();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // ─── Abort an in-progress crossfade (e.g. user clicked a new song) ───────
  function abortCrossfade() {
    if (!crossfading.current) return;
    crossfading.current = false;
    if (xfadeTimer.current !== null) { clearTimeout(xfadeTimer.current); xfadeTimer.current = null; }

    const idleSlot  = activeSlot.current === "A" ? "B" : "A";
    const idleAudio = idleSlot === "A" ? audioARef.current : audioBRef.current;
    const idleGain  = idleSlot === "A" ? gainARef.current  : gainBRef.current;
    const curGain   = activeSlot.current === "A" ? gainARef.current : gainBRef.current;
    const ctx       = ctxRef.current;

    if (idleAudio) { idleAudio.pause(); idleAudio.src = ""; }
    if (ctx) {
      if (curGain)  { curGain.gain.cancelScheduledValues(ctx.currentTime);  curGain.gain.setValueAtTime(1, ctx.currentTime); }
      if (idleGain) { idleGain.gain.cancelScheduledValues(ctx.currentTime); idleGain.gain.setValueAtTime(0, ctx.currentTime); }
    }
  }

  // ─── True crossfade: load next into idle slot, ramp gains on canplay ────────
  function triggerCrossfade(fromSlot: "A" | "B", fadeDuration: number, timeLeft: number) {
    crossfading.current = true;
    // Extract refs before null-check so TypeScript preserves narrowing in closures
    const ctx = ctxRef.current;
    const gA = gainARef.current, gB = gainBRef.current;
    const aA = audioARef.current, aB = audioBRef.current;
    if (!ctx || !gA || !gB || !aA || !aB) { crossfading.current = false; return; }

    const toSlot = fromSlot === "A" ? "B" : "A";
    // All const below are typed as non-null because all refs were checked above
    const fGain  = fromSlot === "A" ? gA : gB;
    const tGain  = toSlot   === "A" ? gA : gB;
    const tAudio = toSlot   === "A" ? aA : aB;
    const fAudio = fromSlot === "A" ? aA : aB;

    const store = usePlayerStore.getState();
    const { queue, shuffledQueue, queueIndex, shuffle } = store;
    const activeQueue = shuffle ? shuffledQueue : queue;
    const nextIndex   = (queueIndex + 1) % activeQueue.length;
    const nextTrack   = activeQueue[nextIndex];
    if (!nextTrack) { crossfading.current = false; return; }

    // Record when we triggered so we can adjust timing after buffering delay
    const triggeredAt = ctx.currentTime;

    tAudio.src    = convertFileSrc(nextTrack.path);
    tAudio.volume = store.isMuted ? 0 : store.volume;
    loadedPathRef.current = nextTrack.path;

    function cleanup() {
      tAudio.removeEventListener("canplay", onCanPlay);
      tAudio.removeEventListener("error", onError);
    }

    function onError() {
      cleanup();
      crossfading.current = false;
      if (xfadeTimer.current) { clearTimeout(xfadeTimer.current); xfadeTimer.current = null; }
      const c = ctxRef.current;
      if (c) { fGain.gain.cancelScheduledValues(c.currentTime); fGain.gain.setValueAtTime(1, c.currentTime); }
      usePlayerStore.getState().nextTrack();
    }

    function onCanPlay() {
      cleanup();
      if (!crossfading.current) return;
      const c = ctxRef.current;
      if (!c) return;

      const elapsed        = c.currentTime - triggeredAt;
      const actualTimeLeft = Math.max(0.05, timeLeft - elapsed);
      const now = c.currentTime;

      fGain.gain.cancelScheduledValues(now);
      fGain.gain.setValueAtTime(fGain.gain.value, now);
      fGain.gain.linearRampToValueAtTime(0, now + actualTimeLeft);
      tGain.gain.cancelScheduledValues(now);
      tGain.gain.setValueAtTime(0, now);
      tGain.gain.linearRampToValueAtTime(1, now + fadeDuration);

      c.resume().then(() =>
        tAudio.play().catch(() => {
          crossfading.current = false;
          if (xfadeTimer.current) { clearTimeout(xfadeTimer.current); xfadeTimer.current = null; }
          const c2 = ctxRef.current;
          if (c2) {
            fGain.gain.cancelScheduledValues(c2.currentTime); fGain.gain.setValueAtTime(1, c2.currentTime);
            tGain.gain.cancelScheduledValues(c2.currentTime); tGain.gain.setValueAtTime(0, c2.currentTime);
          }
          usePlayerStore.getState().nextTrack();
        })
      );

      xfadeTimer.current = setTimeout(() => {
        xfadeTimer.current = null;
        fAudio.pause(); fAudio.src = "";
        const c2 = ctxRef.current;
        if (c2) { fGain.gain.cancelScheduledValues(c2.currentTime); fGain.gain.setValueAtTime(1, c2.currentTime); }
        activeSlot.current = toSlot;
        setDuration(tAudio.duration || 0);
        crossfading.current = false;
        usePlayerStore.getState().nextTrack();
      }, fadeDuration * 1000);
    }

    tAudio.addEventListener("canplay", onCanPlay, { once: true });
    tAudio.addEventListener("error", onError, { once: true });
  }

  // ─── Build Web Audio graph lazily on first play ───────────────────────────
  function ensureGraph() {
    if (graphReady.current) return;
    const aA = audioARef.current;
    const aB = audioBRef.current;
    if (!aA || !aB) return;
    graphReady.current = true;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const srcA = ctx.createMediaElementSource(aA);
    const srcB = ctx.createMediaElementSource(aB);
    const gainA = ctx.createGain(); gainA.gain.value = 1;
    const gainB = ctx.createGain(); gainB.gain.value = 0;
    gainARef.current = gainA;
    gainBRef.current = gainB;

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

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = 0; comp.knee.value = 0; comp.ratio.value = 1;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    compRef.current = comp;

    srcA.connect(gainA); srcB.connect(gainB);
    if (filters.length > 0) {
      gainA.connect(filters[0]);
      gainB.connect(filters[0]);
      for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
      filters[filters.length - 1].connect(comp);
    } else {
      gainA.connect(comp);
      gainB.connect(comp);
    }
    comp.connect(ctx.destination);

    const { eqEnabled, eqBands: eb, normalizeVolume } = useSettingsStore.getState();
    eb.forEach((b, i) => { if (filters[i]) filters[i].gain.value = eqEnabled ? b.gain : 0; });
    if (normalizeVolume) { comp.threshold.value = -24; comp.knee.value = 30; comp.ratio.value = 12; }
  }

  // ─── Track change ─────────────────────────────────────────────────────────
  // Skip src update only when the crossfade already pre-loaded this exact path.
  // Any mismatch (user clicking a song during or after a crossfade) aborts the
  // crossfade and loads the new track right away.
  useEffect(() => {
    if (!currentTrack) return;
    if (loadedPathRef.current === currentTrack.path) return;

    // New path — abort crossfade if one is running, then load
    abortCrossfade();
    const audio = activeSlot.current === "A" ? audioARef.current : audioBRef.current;
    if (audio) {
      loadedPathRef.current = currentTrack.path;
      audio.src = convertFileSrc(currentTrack.path);
    }
  }, [currentTrack]);

  // ─── Play / pause ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) return;
    const audio = activeSlot.current === "A" ? audioARef.current : audioBRef.current;
    if (!audio) return;
    if (isPlaying) {
      ensureGraph();
      ctxRef.current?.resume().then(() => audio.play()).catch(console.error);
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // ─── Volume ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const effective = isMuted ? 0 : volume;
    [audioARef, audioBRef].forEach((r) => { if (r.current) r.current.volume = effective; });
  }, [volume, isMuted]);

  // ─── EQ ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const filters = filtersRef.current;
    if (!filters.length) return;
    eqBands.forEach((band, i) => {
      if (filters[i]) filters[i].gain.value = eqEnabled ? band.gain : 0;
    });
  }, [eqEnabled, eqBands]);

  // ─── Normalization ────────────────────────────────────────────────────────
  useEffect(() => {
    const comp = compRef.current;
    if (!comp) return;
    if (normalizeVolume) { comp.threshold.value = -24; comp.knee.value = 30; comp.ratio.value = 12; }
    else                 { comp.threshold.value = 0;   comp.knee.value = 0;  comp.ratio.value = 1;  }
  }, [normalizeVolume]);

  // ─── Media Session API ────────────────────────────────────────────────────
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  currentTrack.title,
      artist: currentTrack.artist,
      album:  currentTrack.album,
    });
    navigator.mediaSession.setActionHandler("play",          () => usePlayerStore.getState().setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause",         () => usePlayerStore.getState().setIsPlaying(false));
    navigator.mediaSession.setActionHandler("nexttrack",     () => usePlayerStore.getState().nextTrack());
    navigator.mediaSession.setActionHandler("previoustrack", () => usePlayerStore.getState().previousTrack());
    navigator.mediaSession.setActionHandler("seekto",        (d) => { if (d.seekTime !== undefined) seek(d.seekTime); });
  }, [currentTrack]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // ─── Seek ─────────────────────────────────────────────────────────────────
  function seek(time: number) {
    const audio = activeSlot.current === "A" ? audioARef.current : audioBRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setProgress(time);
  }

  return { progress, duration, seek, audioRef: audioARef };
}
