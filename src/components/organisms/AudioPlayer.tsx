import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { useContextMenuStore } from "../../store/contextMenuStore";
import { useRecentlyPlayedStore } from "../../store/recentlyPlayedStore";
import { useVideoStore } from "../../store/videoStore";
import { PlayButton } from "../atoms/PlayButton";
import { SkipButton } from "../atoms/SkipButton";
import { ProgressBar } from "../atoms/ProgressBar";
import { VolumeSlider } from "../atoms/VolumeSlider";
import { ShuffleButton } from "../atoms/ShuffleButton";
import { RepeatButton } from "../atoms/RepeatButton";
import { useArtwork } from "../../hooks/useArtwork";
import { useSettingsStore, type ShortcutId } from "../../store/settingsStore";
import { Equalizer } from "./Equalizer";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./LyricsPanel";
import { NowPlayingView } from "./NowPlayingView";
import { Tooltip } from "../atoms/Tooltip";

function fmtKey(key: string) {
  const map: Record<string, string> = {
    space: "Space", ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "⌘",
  };
  return key.split("+").map((p) => map[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p)).join("+");
}

export function AudioPlayer() {
  const { progress, duration, seek, analyserRef } = useAudioPlayer();
  const {
    currentTrack, isPlaying, volume, isMuted, shuffle, repeat, manualQueuePaths,
    setIsPlaying, setVolume, toggleMute, nextTrack, previousTrack,
    toggleShuffle, toggleRepeat, closePlayer,
  } = usePlayerStore();
  const { message: toastMessage, visible: toastVisible } = useToastStore();
  const showContextMenu = useContextMenuStore((s) => s.show);

  const { data: artworkUrl } = useArtwork(currentTrack?.path, false, true);
  const addRecentlyPlayed = useRecentlyPlayedStore((s) => s.add);
  const [eqOpen, setEqOpen] = useState(false);
  const eqEnabled = useSettingsStore((s) => s.eqEnabled);
  const keyBindings = useSettingsStore((s) => s.keyBindings);
  const keyBindings2 = useSettingsStore((s) => s.keyBindings2);

  useEffect(() => {
    if (currentTrack) addRecentlyPlayed(currentTrack);
  }, [currentTrack?.path]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'queue' | 'lyrics' | null>(null);
  const eqRef = useRef<HTMLDivElement>(null);

  // Always-fresh handlers — refs let the keyboard effect call them without stale closures
  const handleQueueClickRef = useRef<() => void>(() => {});
  const handleLyricsClickRef = useRef<() => void>(() => {});
  handleQueueClickRef.current = () => {
    if (!queueOpen) {
      setQueueOpen(true);
      setActivePanel('queue');
    } else if (activePanel === 'queue') {
      setQueueOpen(false);
      setActivePanel(lyricsOpen ? 'lyrics' : null);
    } else {
      setActivePanel('queue');
    }
  };
  handleLyricsClickRef.current = () => {
    if (!lyricsOpen) {
      setLyricsOpen(true);
      setActivePanel('lyrics');
    } else if (activePanel === 'lyrics') {
      setLyricsOpen(false);
      setActivePanel(queueOpen ? 'queue' : null);
    } else {
      setActivePanel('lyrics');
    }
  };

  useEffect(() => {
    if (!eqOpen) return;
    function handleClick(e: MouseEvent) {
      if (eqRef.current && !eqRef.current.contains(e.target as Node)) setEqOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [eqOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!currentTrack) return;
      // While the video player is open its own shortcuts own the keyboard —
      // otherwise Space/F/etc. would control music and video at once.
      if (useVideoStore.getState().playing) return;
      const target = document.activeElement as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) return;

      const { keyBindings, keyBindings2 } = useSettingsStore.getState();
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("ctrl");
      if (e.altKey) mods.push("alt");
      if (e.shiftKey) mods.push("shift");
      if (e.metaKey) mods.push("meta");
      mods.push(e.key === " " ? "space" : e.key.toLowerCase());
      const pressed = mods.join("+");
      const norm = (s: string) => s.toLowerCase();
      const matches = (id: ShortcutId) =>
        norm(pressed) === norm(keyBindings[id]) ||
        (!!keyBindings2[id] && norm(pressed) === norm(keyBindings2[id]));

      if      (matches("play-pause"))   { e.preventDefault(); setIsPlaying(!isPlaying); }
      else if (matches("seek-forward")) { e.preventDefault(); seek(Math.min(progress + 5, duration)); }
      else if (matches("seek-back"))    { e.preventDefault(); seek(Math.max(progress - 5, 0)); }
      else if (matches("now-playing"))  { e.preventDefault(); setNowPlayingOpen((v) => !v); }
      else if (matches("queue"))        { e.preventDefault(); handleQueueClickRef.current(); }
      else if (matches("equalizer"))    { e.preventDefault(); setEqOpen((v) => !v); }
      else if (matches("mute"))         { e.preventDefault(); toggleMute(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentTrack, isPlaying, progress, duration]);

  // ─── Mini player bridge (BroadcastChannel — works reliably across same-origin windows) ──

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const seekRef = useRef(seek);
  seekRef.current = seek;

  const stateBCRef = useRef<BroadcastChannel | null>(null);

  function broadcastState() {
    const s = usePlayerStore.getState();
    stateBCRef.current?.postMessage({
      track:     s.currentTrack,
      isPlaying: s.isPlaying,
      progress:  progressRef.current,
      duration:  durationRef.current,
      volume:    s.volume,
    });
  }

  useEffect(() => { broadcastState(); }, [currentTrack?.path, isPlaying]);

  // Volume is debounced separately: postMessage structured-clones the whole
  // track object, and slider drags fire at input-event rate — broadcasting
  // each tick contributes to main-thread stalls that crackle the audio.
  useEffect(() => {
    const id = setTimeout(broadcastState, 150);
    return () => clearTimeout(id);
  }, [volume]);

  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const id = setInterval(broadcastState, 1000);
    return () => clearInterval(id);
  }, [isPlaying, currentTrack?.path]);

  useEffect(() => {
    const stateBC = new BroadcastChannel("libera-state");
    const ctrlBC  = new BroadcastChannel("libera-control");
    stateBCRef.current = stateBC;

    ctrlBC.onmessage = (ev) => {
      const { action, value } = ev.data as { action: string; value?: number };
      const store = usePlayerStore.getState();
      if      (action === "request-state")                 broadcastState();
      else if (action === "toggle-play")                   store.setIsPlaying(!store.isPlaying);
      else if (action === "next")                          store.nextTrack();
      else if (action === "prev")                          store.previousTrack();
      else if (action === "seek"   && value !== undefined) seekRef.current(value);
      else if (action === "volume" && value !== undefined) store.setVolume(value);
    };

    return () => {
      stateBC.close();
      ctrlBC.close();
      stateBCRef.current = null;
    };
  }, []);

  async function openMiniPlayer() {
    try {
      const existing = await WebviewWindow.getByLabel("mini-player");
      if (existing) { await existing.setFocus(); return; }
    } catch {}
    new WebviewWindow("mini-player", {
      url: "/",
      title: "Mini Player",
      width: 320,
      height: 68,
      minWidth: 48,
      minHeight: 48,
      maxWidth: 900,
      maxHeight: 400,
      decorations: false,
      alwaysOnTop: true,
      resizable: true,
      shadow: true,
    });
  }

  if (!currentTrack) {
    return (
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            key="queue-toast"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{    opacity: 0, y: 6,  scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#2a2820] border border-white/8 shadow-xl pointer-events-none"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--accent)] shrink-0">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
            <span className="text-xs font-mono text-[#c8bfa8] whitespace-nowrap">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <>
      <div className="w-full shrink-0 bg-[#161410] border-t border-white/5 z-50">

        {/* ── Mobile: compact bar (< sm) ─────────────────────────── */}
        <div className="flex sm:hidden items-center h-16 px-3 gap-2 relative">
          {/* Thin progress line at top */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#1f1d18]">
            <div
              className="h-full bg-[var(--accent)] transition-none"
              style={{ width: `${duration > 0 ? (progress / duration) * 100 : 0}%` }}
            />
          </div>

          {/* Album art — tap to open Now Playing */}
          <button
            onClick={() => setNowPlayingOpen(true)}
            onContextMenu={(e) => { e.preventDefault(); showContextMenu(currentTrack, e.clientX, e.clientY); }}
            aria-label="Open now playing"
            className="w-10 h-10 rounded-md bg-[#2a2820] shrink-0 overflow-hidden active:opacity-70"
          >
            {artworkUrl ? (
              <img src={artworkUrl} alt={currentTrack.album} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </button>

          {/* Track info — tap to open Now Playing */}
          <button
            onClick={() => setNowPlayingOpen(true)}
            aria-label="Open now playing"
            className="min-w-0 flex-1 text-left active:opacity-70"
          >
            <p className="text-sm text-[#f0ead8] truncate leading-snug">{currentTrack.title}</p>
            <p className="text-xs text-[#7a7060] truncate leading-snug">{currentTrack.artist}</p>
          </button>

          {/* Playback controls */}
          <div className="flex items-center shrink-0">
            <SkipButton direction="previous" onClick={previousTrack} />
            <PlayButton isPlaying={isPlaying} onClick={() => setIsPlaying(!isPlaying)} />
            <SkipButton direction="next" onClick={nextTrack} />
          </div>
        </div>

        {/* ── Desktop: full bar (≥ sm) ───────────────────────────── */}
        <div className="hidden sm:flex items-center h-20 px-6 gap-6">
          {/* Track info */}
          <div
            className="flex items-center gap-3 min-w-0 w-56"
            onContextMenu={(e) => { e.preventDefault(); showContextMenu(currentTrack, e.clientX, e.clientY); }}
          >
            <Tooltip label="Now Playing" shortcut={fmtKey(keyBindings["now-playing"])} altShortcut={keyBindings2["now-playing"] ? fmtKey(keyBindings2["now-playing"]) : undefined}>
              <button
                onClick={() => setNowPlayingOpen(true)}
                className="w-10 h-10 rounded-md bg-[#2a2820] shrink-0 overflow-hidden hover:opacity-80 transition-opacity"
              >
                {artworkUrl ? (
                  <img src={artworkUrl} alt={currentTrack.album} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                )}
              </button>
            </Tooltip>
            <div className="min-w-0">
              <p className="text-sm text-[#f0ead8] truncate">{currentTrack.title}</p>
              <p className="text-xs text-[#7a7060] truncate">{currentTrack.artist}</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col items-center flex-1 gap-2">
            <div className="flex items-center gap-5">
              <ShuffleButton active={shuffle} onClick={toggleShuffle} />
              <SkipButton direction="previous" onClick={previousTrack} />
              <Tooltip label="Play / Pause" shortcut={fmtKey(keyBindings["play-pause"])} altShortcut={keyBindings2["play-pause"] ? fmtKey(keyBindings2["play-pause"]) : undefined}>
                <PlayButton isPlaying={isPlaying} onClick={() => setIsPlaying(!isPlaying)} />
              </Tooltip>
              <SkipButton direction="next" onClick={nextTrack} />
              <RepeatButton mode={repeat} onClick={toggleRepeat} />
            </div>
            <ProgressBar progress={progress} duration={duration} onSeek={seek} />
          </div>

          {/* Volume + EQ + Queue */}
          <div className="flex items-center gap-2 relative" ref={eqRef}>
            <VolumeSlider volume={volume} isMuted={isMuted} onVolumeChange={setVolume} onToggleMute={toggleMute} />

            <Tooltip label="Equalizer" shortcut={fmtKey(keyBindings["equalizer"])} altShortcut={keyBindings2["equalizer"] ? fmtKey(keyBindings2["equalizer"]) : undefined}>
              <button
                onClick={() => setEqOpen((v) => !v)}
                aria-label={eqOpen ? "Close equalizer" : "Equalizer"}
                aria-pressed={eqOpen}
                className={`p-1.5 rounded-md transition-colors ${
                  eqEnabled ? "text-[var(--accent)] bg-[var(--accent-a10)]" : "text-[#3a3628] hover:text-[#7a7060]"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 20v-6.586l-4.707-4.707A1 1 0 015 8V4h14v4a1 1 0 01-.293.707L14 13.414V17l-4 3z" />
                  <path d="M7 4v3.586l4.707 4.707A1 1 0 0112 13v5l1.5-1.125V13a1 1 0 01.293-.707L18 7.586V4H7z" />
                </svg>
              </button>
            </Tooltip>

            <button
              onClick={() => handleLyricsClickRef.current()}
              aria-label={lyricsOpen ? "Close lyrics" : "Lyrics"}
              aria-pressed={lyricsOpen}
              className={`p-1.5 rounded-md transition-colors ${
                lyricsOpen ? "text-[var(--accent)] bg-[var(--accent-a10)]" : "text-[#3a3628] hover:text-[#7a7060]"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </button>

            <Tooltip label="Queue" shortcut={fmtKey(keyBindings["queue"])} altShortcut={keyBindings2["queue"] ? fmtKey(keyBindings2["queue"]) : undefined}>
              <button
                onClick={() => handleQueueClickRef.current()}
                aria-label={queueOpen ? "Close queue" : "Queue"}
                aria-pressed={queueOpen}
                className={`relative p-1.5 rounded-md transition-colors ${
                  queueOpen ? "text-[var(--accent)] bg-[var(--accent-a10)]" : "text-[#3a3628] hover:text-[#7a7060]"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
                </svg>
                {manualQueuePaths.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--accent)] text-[8px] font-mono flex items-center justify-center" style={{ color: "var(--accent-on)" }}>
                    {Math.min(manualQueuePaths.length, 99)}
                  </span>
                )}
              </button>
            </Tooltip>

            <button
              onClick={openMiniPlayer}
              aria-label="Pop out mini player"
              className="p-1.5 rounded-md transition-colors text-[#3a3628] hover:text-[#7a7060]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
              </svg>
            </button>

            <button
              onClick={closePlayer}
              aria-label="Close player"
              className="p-1.5 rounded-md transition-colors text-[#2a2820] hover:text-red-400"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>

            {eqOpen && (
              <div className="absolute bottom-12 right-0 z-50 shadow-2xl">
                <Equalizer compact onClose={() => setEqOpen(false)} analyserRef={analyserRef} />
              </div>
            )}
          </div>
        </div>
      </div>

      <QueuePanel
        open={queueOpen}
        onClose={() => { setQueueOpen(false); setActivePanel(lyricsOpen ? 'lyrics' : null); }}
        isOnTop={activePanel === 'queue'}
        onBringToFront={() => setActivePanel('queue')}
      />
      <LyricsPanel
        open={lyricsOpen}
        onClose={() => { setLyricsOpen(false); setActivePanel(queueOpen ? 'queue' : null); }}
        isOnTop={activePanel === 'lyrics'}
        onBringToFront={() => setActivePanel('lyrics')}
        progress={progress}
        seek={seek}
      />

      {/* Tab switcher — visible when both panels are open, sits just left of the stacked panels */}
      {queueOpen && lyricsOpen && (
        <div className="fixed right-80 top-1/2 -translate-y-1/2 z-[53] flex flex-col py-1 px-0.5 bg-[#1a1814] border border-white/8 border-r-0 rounded-l-lg shadow-xl">
          <button
            onClick={() => setActivePanel('lyrics')}
            aria-label="Show lyrics"
            aria-pressed={activePanel === 'lyrics'}
            className={`p-2 rounded-md transition-colors ${activePanel === 'lyrics' ? 'text-[var(--accent)]' : 'text-[#3a3628] hover:text-[#7a7060]'}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </button>
          <button
            onClick={() => setActivePanel('queue')}
            aria-label="Show queue"
            aria-pressed={activePanel === 'queue'}
            className={`p-2 rounded-md transition-colors ${activePanel === 'queue' ? 'text-[var(--accent)]' : 'text-[#3a3628] hover:text-[#7a7060]'}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
            </svg>
          </button>
        </div>
      )}
      <NowPlayingView
        open={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        progress={progress}
        duration={duration}
        seek={seek}
      />

      {/* Queue action toast */}
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            key="queue-toast"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{    opacity: 0, y: 6,  scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed bottom-24 sm:bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#2a2820] border border-white/8 shadow-xl pointer-events-none"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--accent)] shrink-0">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
            <span className="text-xs font-mono text-[#c8bfa8] whitespace-nowrap">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
