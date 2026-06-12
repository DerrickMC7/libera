import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateVideoMetadata, useSetVideoProgress, useVideoSubtitles } from "../../hooks/useVideos";
import { useVideoStore } from "../../store/videoStore";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { isWatched } from "../../types/video";
import { VolumeSlider } from "../atoms/VolumeSlider";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface VideoPlayerProps {
  onClose: () => void;
}

export function VideoPlayer({ onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    playing: video, playingList, step, autoplayNext, setAutoplayNext,
    volume: storedVolume, setVolume: storeVolume,
  } = useVideoStore();
  const { show: showToast } = useToastStore();

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video?.duration_secs || 0);
  const [volume, setVolume] = useState(storedVolume);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSub, setActiveSub] = useState(-1); // -1 = off
  const [loadError, setLoadError] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<{ t: number; x: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // Transient on-screen feedback (YouTube-style): skip amount or play flash.
  // Keyed by id so rapid repeats restart the fade animation.
  const [osd, setOsd] = useState<{ id: number; kind: "play" } | { id: number; kind: "skip"; secs: number } | null>(null);

  const { mutate: updateMeta } = useUpdateVideoMetadata();
  const { mutate: saveProgress } = useSetVideoProgress();
  const { data: subtitles = [] } = useVideoSubtitles(IS_DEMO ? null : video?.path ?? null);
  const qc = useQueryClient();

  const idx = video ? playingList.findIndex((v) => v.path === video.path) : -1;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < playingList.length - 1;
  const nextVideo = hasNext ? playingList[idx + 1] : null;

  const src = video ? (IS_DEMO ? video.path : convertFileSrc(video.path)) : "";

  // ── Progress persistence ────────────────────────────────────────────────────
  const positionRef = useRef({ path: "", secs: 0, dur: 0 });

  const flushProgress = useCallback(() => {
    const { path, secs, dur } = positionRef.current;
    if (IS_DEMO || !path || secs < 5) return;
    saveProgress({ path, watchedSecs: Math.floor(secs), durationSecs: Math.floor(dur) });
  }, [saveProgress]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(flushProgress, 5000);
    return () => clearInterval(id);
  }, [playing, flushProgress]);

  useEffect(() => {
    return () => {
      flushProgress();
      qc.invalidateQueries({ queryKey: ["videos-all"] });
    };
  }, [flushProgress, qc]);

  // ── Controls auto-hide while playing (both modes) ──────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (playing) {
      controlsTimerRef.current = setTimeout(() => { setShowControls(false); setMenuOpen(false); }, 3000);
    }
  }, [playing]);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  useEffect(() => { resetControlsTimer(); }, [playing, resetControlsTimer]);

  // ── Basic controls ──────────────────────────────────────────────────────────
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
  }

  // Single click = play/pause, double click = fullscreen (debounced so a
  // double click doesn't also toggle playback twice)
  function handleVideoClick() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      toggleFullscreen();
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      togglePlay();
    }, 220);
  }

  function seekTo(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, v.duration || t));
    setCurrentTime(v.currentTime);
  }

  function nudge(secs: number) {
    const v = videoRef.current;
    if (!v) return;
    seekTo(v.currentTime + secs);
    setOsd({ id: Date.now(), kind: "skip", secs });
  }

  function handleVolumeChange(val: number) {
    setVolume(val);
    storeVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      if (val > 0 && muted) { videoRef.current.muted = false; setMuted(false); }
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function changeSpeed(s: number) {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  }

  function goStep(dir: 1 | -1) {
    flushProgress();
    setLoadError(false);
    setResumedFrom(null);
    step(dir);
  }

  function startOver() {
    seekTo(0);
    setResumedFrom(null);
  }

  // ── Subtitles ───────────────────────────────────────────────────────────────
  useEffect(() => { setActiveSub(-1); }, [video?.path]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === activeSub ? "showing" : "hidden";
    }
  }, [activeSub, subtitles]);

  useEffect(() => {
    function onFsChange() { setFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Media element events ────────────────────────────────────────────────────
  const resumedPathRef = useRef("");

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !video) return;
    setLoadError(false);
    setBuffering(true);

    // Volume/mute persist across track changes within the session
    v.volume = volume;
    v.muted = muted;

    const onPlay = () => {
      setPlaying(true);
      // One soundtrack at a time: starting a video pauses the music player
      usePlayerStore.getState().setIsPlaying(false);
      setOsd({ id: Date.now(), kind: "play" });
    };
    const onPause = () => { setPlaying(false); flushProgress(); };
    const onTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      positionRef.current = { path: video.path, secs: v.currentTime, dur: v.duration || video.duration_secs };
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onCanPlay = () => setBuffering(false);
    const onLoaded = () => {
      const d = v.duration;
      setDuration(d);
      v.playbackRate = speed;
      if (!IS_DEMO && isFinite(d) && d > 0 && video.duration_secs === 0) {
        updateMeta({ path: video.path, durationSecs: Math.round(d), width: v.videoWidth, height: v.videoHeight });
      }
      if (resumedPathRef.current !== video.path) {
        resumedPathRef.current = video.path;
        const target = video.watched_secs;
        if (target > 10 && isFinite(d) && d > 0 && target < d * 0.95 && !isWatched(video)) {
          v.currentTime = target;
          setResumedFrom(target);
        } else {
          setResumedFrom(null);
        }
      }
    };
    const onEnded = () => {
      setPlaying(false);
      if (!IS_DEMO && isFinite(v.duration) && v.duration > 0) {
        saveProgress({ path: video.path, watchedSecs: Math.floor(v.duration), durationSecs: Math.floor(v.duration) });
        positionRef.current = { path: "", secs: 0, dur: 0 };
      }
      if (autoplayNext && hasNext && nextVideo) {
        showToast(`Up next: ${nextVideo.title}`);
        setLoadError(false);
        setResumedFrom(null);
        step(1);
      }
    };
    const onError = () => { setLoadError(true); setBuffering(false); };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.path, autoplayNext, hasNext]);

  // Auto-hide the resume chip after a few seconds
  useEffect(() => {
    if (resumedFrom === null) return;
    const id = setTimeout(() => setResumedFrom(null), 6000);
    return () => clearTimeout(id);
  }, [resumedFrom]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = document.activeElement as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      switch (e.key) {
        case " ": case "k": e.preventDefault(); togglePlay(); break;
        case "ArrowLeft":  nudge(-5); break;
        case "ArrowRight": nudge(5); break;
        case "j": case "J": nudge(-10); break;
        case "l": case "L": nudge(10); break;
        case "ArrowUp":    { const v = videoRef.current; if (v) { const n = Math.min(1, v.volume + 0.1); handleVolumeChange(n); } break; }
        case "ArrowDown":  { const v = videoRef.current; if (v) { const n = Math.max(0, v.volume - 0.1); handleVolumeChange(n); } break; }
        case "m": case "M": e.preventDefault(); toggleMute(); break;
        case "f": case "F": e.preventDefault(); toggleFullscreen(); break;
        case "n": case "N": e.preventDefault(); if (hasNext) goStep(1); break;
        case "Escape": if (!fullscreen) onClose(); break;
      }
      resetControlsTimer();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, onClose, resetControlsTimer, hasNext]);

  if (!video) return null;

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const playerTitle = video.series
    ? `${video.series} — S${String(video.season).padStart(2, "0")}E${String(video.episode).padStart(2, "0")} · ${video.title}`
    : video.title;
  const controlsVisible = showControls || !playing;

  // ── Progress bar: hover timestamp + click/drag scrubbing ───────────────────
  // Pointer capture lets the user press, hold, and drag anywhere — the video
  // live-seeks while dragging (YouTube-style scrubbing).
  const barFrac = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { frac: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), x: e.clientX - r.left };
  };

  const progressBar = (
    <div
      className="relative h-1.5 group cursor-pointer touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setScrubbing(true);
        seekTo(barFrac(e).frac * duration);
      }}
      onPointerMove={(e) => {
        const { frac, x } = barFrac(e);
        setHoverTime({ t: frac * duration, x });
        if (scrubbing) seekTo(frac * duration);
      }}
      onPointerUp={() => setScrubbing(false)}
      onPointerCancel={() => setScrubbing(false)}
      onMouseLeave={() => { if (!scrubbing) setHoverTime(null); }}
    >
      <div className="absolute inset-y-0 inset-x-0 my-auto h-1 group-hover:h-1.5 transition-all bg-white/20 rounded-full" />
      <div className="absolute inset-y-0 left-0 my-auto h-1 group-hover:h-1.5 transition-all bg-white/40 rounded-full" style={{ width: `${bufferedPct}%` }} />
      <div className="absolute inset-y-0 left-0 my-auto h-1 group-hover:h-1.5 transition-all bg-[var(--accent)] rounded-full" style={{ width: `${progressPct}%` }} />
      {/* Scrubber dot */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity shadow"
        style={{ left: `calc(${progressPct}% - 6px)` }}
      />
      {hoverTime !== null && duration > 0 && (
        <div
          className="absolute bottom-full mb-2 px-1.5 py-0.5 rounded bg-black/90 text-white/90 text-[10px] font-mono pointer-events-none -translate-x-1/2"
          style={{ left: hoverTime.x }}
        >
          {formatTime(hoverTime.t)}
        </div>
      )}
      {/* Larger invisible hit area */}
      <div className="absolute -inset-y-2 inset-x-0" />
    </div>
  );

  // YouTube-style row: transport + volume + time on the left, settings +
  // fullscreen on the right. Nothing is "centered" so nothing gets pushed
  // off-center by the volume slider.
  const playbackButtons = (
    <div className="flex items-center gap-0.5 min-w-0">
      <button onClick={togglePlay} className="p-2 text-white hover:text-white transition-colors" title="Play/Pause (Space)">
        {playing
          ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      <button onClick={() => goStep(-1)} disabled={!hasPrev} className="p-2 text-white/70 hover:text-white transition-colors disabled:opacity-30" title="Previous">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
      </button>
      <button onClick={() => goStep(1)} disabled={!hasNext} className="p-2 text-white/70 hover:text-white transition-colors disabled:opacity-30" title="Next (N)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>
      <button onClick={() => nudge(-10)} className="p-2 text-white/70 hover:text-white transition-colors" title="Back 10s (J)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
      </button>
      <button onClick={() => nudge(10)} className="p-2 text-white/70 hover:text-white transition-colors" title="Forward 10s (L)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>
      </button>
      <VolumeSlider volume={volume} isMuted={muted} onVolumeChange={handleVolumeChange} onToggleMute={toggleMute} />
      <span className="text-white/60 text-xs font-mono tabular-nums shrink-0 whitespace-nowrap">
        {formatTime(currentTime)} <span className="text-white/30">/ {formatTime(duration)}</span>
      </span>
    </div>
  );

  const settingsMenu = (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className={`p-2 transition-colors ${menuOpen ? "text-white" : "text-white/60 hover:text-white"}`}
        title="Playback settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-56 bg-[#1a1814] border border-white/10 rounded-lg shadow-xl py-2 z-30" onClick={(e) => e.stopPropagation()}>
          <p className="px-3 pb-1 text-[10px] font-mono uppercase tracking-widest text-[#5a5244]">Speed</p>
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => changeSpeed(s)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${speed === s ? "bg-[var(--accent)] text-white" : "bg-white/5 text-[#7a7060] hover:text-white"}`}
              >
                {s}×
              </button>
            ))}
          </div>

          {subtitles.length > 0 && (
            <>
              <p className="px-3 pb-1 text-[10px] font-mono uppercase tracking-widest text-[#5a5244]">Subtitles</p>
              <div className="px-3 pb-2 flex flex-col gap-0.5">
                <button
                  onClick={() => setActiveSub(-1)}
                  className={`text-left px-2 py-1 rounded text-xs transition-colors ${activeSub === -1 ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[#7a7060] hover:text-white hover:bg-white/5"}`}
                >
                  Off
                </button>
                {subtitles.map((t, i) => (
                  <button
                    key={t.vtt_path}
                    onClick={() => setActiveSub(i)}
                    className={`text-left px-2 py-1 rounded text-xs transition-colors capitalize ${activeSub === i ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[#7a7060] hover:text-white hover:bg-white/5"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="px-3 pt-1 border-t border-white/5 flex items-center justify-between">
            <span className="text-xs text-[#7a7060]">Autoplay next</span>
            <button
              onClick={() => setAutoplayNext(!autoplayNext)}
              className={`w-8 rounded-full transition-colors relative ${autoplayNext ? "bg-[var(--accent)]" : "bg-white/10"}`}
              style={{ height: 18 }}
            >
              <span
                className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all"
                style={{ left: autoplayNext ? 16 : 2 }}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const fullscreenButton = (
    <button onClick={toggleFullscreen} className="p-2 text-white/60 hover:text-white transition-colors" title="Fullscreen (F)">
      {fullscreen ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
        </svg>
      )}
    </button>
  );

  // The control strip shared by both layouts — YouTube arrangement:
  // full-width progress bar on top, left-aligned transport below, utilities right.
  const controlStrip = (
    <>
      <div className="mb-1.5 px-1">{progressBar}</div>
      <div className="flex items-center justify-between gap-2">
        {playbackButtons}
        <div className="flex items-center shrink-0">
          {settingsMenu}
          {fullscreenButton}
        </div>
      </div>
    </>
  );

  const videoArea = (className: string) => (
    <div className={className} onMouseMove={resetControlsTimer}>
      <video
        ref={videoRef}
        src={src}
        className="absolute inset-0 w-full h-full object-contain"
        autoPlay
        crossOrigin="anonymous"
        onClick={handleVideoClick}
        style={{ cursor: controlsVisible ? "default" : "none" }}
      >
        {subtitles.map((t) => (
          <track key={t.vtt_path} kind="subtitles" label={t.label} src={convertFileSrc(t.vtt_path)} />
        ))}
      </video>

      {/* Transient OSD flash: skip amount (left/right) or play icon (center).
          The outer div handles positioning; the inner motion.div animates
          scale+fade (framer's transform would override positional translates). */}
      {osd && (
        <div
          key={osd.id}
          className={`absolute inset-0 z-20 pointer-events-none flex items-center ${
            osd.kind === "skip" ? (osd.secs < 0 ? "justify-start pl-[14%]" : "justify-end pr-[14%]") : "justify-center"
          }`}
        >
          <motion.div
            initial={{ opacity: 0.95, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.45 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            onAnimationComplete={() => setOsd((cur) => (cur?.id === osd.id ? null : cur))}
            className={`bg-black/60 rounded-full flex items-center gap-2 text-white ${osd.kind === "play" ? "p-5" : "px-5 py-4"}`}
          >
            {osd.kind === "play" ? (
              // Two bars = "now playing" (matches the state the transport button shows)
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            ) : osd.secs < 0 ? (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6L11 18zm.5-6 8.5 6V6l-8.5 6z" /></svg>
                <span className="text-sm font-mono font-semibold">{osd.secs}s</span>
              </>
            ) : (
              <>
                <span className="text-sm font-mono font-semibold">+{osd.secs}s</span>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" /></svg>
              </>
            )}
          </motion.div>
        </div>
      )}

      {/* Buffering spinner */}
      {buffering && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-10 h-10 border-[3px] border-white/20 border-t-white/80 rounded-full animate-spin" />
        </div>
      )}

      {/* Resume chip */}
      <AnimatePresence>
        {resumedFrom !== null && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-black/80 rounded-full pl-4 pr-2 py-1.5"
          >
            <span className="text-white/80 text-xs">Resumed at {formatTime(resumedFrom)}</span>
            <button
              onClick={startOver}
              className="text-[var(--accent)] hover:text-white text-xs font-mono px-2 py-0.5 rounded-full bg-white/5 hover:bg-[var(--accent)]/30 transition-colors"
            >
              Start over
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Prev/next arrows */}
      {hasPrev && (
        <button
          onClick={() => goStep(-1)}
          className={`absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/50 hover:bg-black/80 text-white transition-all z-10 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      {hasNext && (
        <button
          onClick={() => goStep(1)}
          className={`absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/50 hover:bg-black/80 text-white transition-all z-10 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      )}

      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-3">
          <p className="text-white/60 text-sm bg-black/60 px-4 py-2 rounded-lg">
            {IS_DEMO ? "Playback isn't available in demo mode" : "Couldn't play this file — the codec may not be supported"}
          </p>
          {hasNext && (
            <button onClick={() => goStep(1)} className="text-[var(--accent)] text-xs font-mono hover:underline">
              Skip to next →
            </button>
          )}
        </div>
      )}

      {/* Persistent paused overlay — disappears INSTANTLY on play (no exit
          fade) so only the OSD "playing" flash is seen during the transition */}
      {!playing && !loadError && !buffering && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12 }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
        >
          <div className="bg-black/60 rounded-full p-5">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </motion.div>
      )}
    </div>
  );

  // ── Layout ──────────────────────────────────────────────────────────────────
  // ONE element tree for windowed and fullscreen — only classNames change.
  // Rendering different trees per mode would remount the <video> element on
  // every fullscreen toggle, reloading the file and restarting playback.
  const fsBarsVisible = !fullscreen || controlsVisible;

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={fullscreen
          ? "fixed inset-0 z-[70] bg-black"
          : "fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4 sm:p-8"}
        onMouseMove={resetControlsTimer}
        onClick={fullscreen ? undefined : (e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className={fullscreen
            ? "relative w-full h-full"
            : "w-full flex flex-col rounded-2xl overflow-hidden shadow-2xl bg-[#0e0d0b]"}
          style={fullscreen ? undefined : { maxWidth: "min(1100px, calc((92vh - 120px) * 16 / 9))" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Stage: fills the screen in fullscreen, fixed 16:9 in windowed */}
          {videoArea(fullscreen ? "absolute inset-0" : "relative w-full aspect-video bg-black")}

          {/* Title row: top overlay in fullscreen, bar header in windowed */}
          <div
            className={fullscreen
              ? "absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 to-transparent px-4 pt-3 pb-10 flex items-center transition-opacity duration-200"
              : "shrink-0 bg-[#161410] border-t border-white/5 px-4 pt-3 pb-1 flex items-center transition-opacity"}
            style={fullscreen ? { opacity: fsBarsVisible ? 1 : 0, pointerEvents: fsBarsVisible ? "auto" : "none" } : undefined}
          >
            <div className="w-8" />
            <p className={`truncate flex-1 text-center font-medium ${fullscreen ? "text-white/80 text-sm mx-4" : "text-white/70 text-xs mx-3"}`}>{playerTitle}</p>
            <button onClick={onClose} className="p-1.5 text-white/50 hover:text-white transition-colors" title="Close (Esc)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Controls: bottom overlay in fullscreen, solid bar in windowed */}
          <div
            className={fullscreen
              ? "absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-12 transition-opacity duration-200"
              : "shrink-0 bg-[#161410] px-4 pt-2 pb-4"}
            style={fullscreen ? { opacity: fsBarsVisible ? 1 : 0, pointerEvents: fsBarsVisible ? "auto" : "none" } : undefined}
          >
            {controlStrip}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
