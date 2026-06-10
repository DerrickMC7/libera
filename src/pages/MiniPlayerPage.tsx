import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useArtwork } from "../hooks/useArtwork";
import { useSettingsStore, AccentColor } from "../store/settingsStore";
import { Track } from "../types/track";

// ─── Theme ───────────────────────────────────────────────────────────────────

type PresetColor = Exclude<AccentColor, "custom">;
const ACCENT_MAP: Record<PresetColor, { base: string; hover: string; rgb: string }> = {
  amber:  { base: "#d4872a", hover: "#e8a84c", rgb: "212,135,42"  },
  blue:   { base: "#3b82f6", hover: "#60a5fa", rgb: "59,130,246"  },
  green:  { base: "#22c55e", hover: "#4ade80", rgb: "34,197,94"   },
  purple: { base: "#a855f7", hover: "#c084fc", rgb: "168,85,247"  },
  red:    { base: "#ef4444", hover: "#f87171", rgb: "239,68,68"   },
};
function hexToRgb(h: string) {
  return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)].join(",");
}
function lighten(hex: string) {
  const l = (c: number) => Math.min(255, Math.round(c + (255-c)*0.25));
  return "#" + [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
    .map(x => l(x).toString(16).padStart(2,"0")).join("");
}
function accentOn(hex: string) {
  const lin = (c: number) => { const s=c/255; return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4; };
  const [r,g,b] = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].map(lin);
  return 0.2126*r+0.7152*g+0.0722*b > 0.45 ? "#1a1814" : "#ffffff";
}
function useMiniTheme() {
  const { accentColor, customAccentHex } = useSettingsStore();
  useEffect(() => {
    let base: string, hover: string, rgb: string;
    if (accentColor === "custom") {
      base = customAccentHex || "#8b5cf6"; hover = lighten(base); rgb = hexToRgb(base);
    } else {
      ({ base, hover, rgb } = ACCENT_MAP[accentColor]);
    }
    const el = document.documentElement;
    el.style.setProperty("--accent",       base);
    el.style.setProperty("--accent-hover", hover);
    el.style.setProperty("--accent-on",    accentOn(base));
    el.style.setProperty("--accent-a08",   `rgba(${rgb},0.08)`);
    el.style.setProperty("--accent-a10",   `rgba(${rgb},0.10)`);
    el.style.setProperty("--accent-a20",   `rgba(${rgb},0.20)`);
    el.style.setProperty("--accent-a30",   `rgba(${rgb},0.30)`);
  }, [accentColor, customAccentHex]);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MiniPlayerState {
  track: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
}

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  return `${m}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
}

// ─── Module-level atoms (stable references — never remount on parent re-render) ──

function ArtworkAtom({ path, size }: { path: string; size: number }) {
  const { data: url } = useArtwork(path, false, true);
  return (
    <div className="shrink-0 overflow-hidden bg-[#1a1814]" style={{ width: size, height: size }}>
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
        : <div className="w-full h-full flex items-center justify-center">
            <svg width={Math.max(10, size * 0.35)} height={Math.max(10, size * 0.35)} viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
      }
    </div>
  );
}

// Generic icon button: always in DOM, opacity-0 + pointer-events-none when dimmed (no layout shift)
function CtrlBtn({
  onClick, dimmed = false, size = 20, children,
}: {
  onClick: () => void;
  dimmed?: boolean;
  size?: number;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center text-[#7a7060] hover:text-[#f0ead8] active:scale-90 shrink-0"
      style={{
        width: size,
        height: size,
        opacity: dimmed ? 0 : 1,
        pointerEvents: dimmed ? "none" : "auto",
        transition: "opacity 0.12s, color 0.12s, transform 0.08s",
      }}
    >
      {children}
    </button>
  );
}

function PlayAtom({ isPlaying, radius, onToggle }: { isPlaying: boolean; radius: number; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="rounded-full bg-[var(--accent)] flex items-center justify-center hover:opacity-90 active:scale-90 transition-all shrink-0"
      style={{ width: radius * 2, height: radius * 2, minWidth: radius * 2, color: "var(--accent-on)" }}
    >
      {isPlaying
        ? <svg width={radius * 0.7} height={radius * 0.7} viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        : <svg width={radius * 0.7} height={radius * 0.7} viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: "1px" }}><path d="M8 5v14l11-7z"/></svg>
      }
    </button>
  );
}

function ProgressStrip({ progress, duration, onSeek }: { progress: number; duration: number; onSeek: (t: number) => void }) {
  const pct = duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;
  return (
    <div
      className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#2a2820] cursor-pointer group"
      onMouseDown={e => e.stopPropagation()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
    >
      <div className="h-full bg-[var(--accent)] group-hover:h-[4px] transition-all origin-bottom" style={{ width: `${pct}%` }} />
    </div>
  );
}

// SVG icon helpers
const IcoPrev  = (s: number) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>;
const IcoNext  = (s: number) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm8.5-6V6h2v12h-2z"/></svg>;
const IcoClose = (s: number) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>;

// ─── Main component ───────────────────────────────────────────────────────────

export function MiniPlayerPage() {
  useMiniTheme();

  const [state, setState] = useState<MiniPlayerState>({
    track: null, isPlaying: false, progress: 0, duration: 0, volume: 1,
  });
  const [hovered, setHovered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 68 });

  // BroadcastChannel ref — stable, used by all control handlers
  const ctrlBCRef = useRef<BroadcastChannel | null>(null);

  // Connect to main window via BroadcastChannel (same-origin, works in WebView2)
  useEffect(() => {
    const stateBC = new BroadcastChannel("libera-state");
    const ctrlBC  = new BroadcastChannel("libera-control");
    ctrlBCRef.current = ctrlBC;

    stateBC.onmessage = (e) => setState(e.data as MiniPlayerState);

    // Ask main window for its current state immediately
    ctrlBC.postMessage({ action: "request-state" });

    return () => {
      stateBC.close();
      ctrlBC.close();
      ctrlBCRef.current = null;
    };
  }, []);

  // Track window size for responsive layout
  useEffect(() => {
    if (!rootRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height });
    });
    obs.observe(rootRef.current);
    return () => obs.disconnect();
  }, []);

  // Drag: call startDragging() explicitly on mousedown of safe areas
  const startDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    getCurrentWindow().startDragging().catch(() => {});
  }, []);

  // Stable callbacks — ctrlBCRef.current is read at call time, not capture time
  const handleClose  = useMemo(() => () => { getCurrentWindow().close().catch(() => {}); }, []);
  const handlePrev   = useMemo(() => () => { ctrlBCRef.current?.postMessage({ action: "prev" }); }, []);
  const handleNext   = useMemo(() => () => { ctrlBCRef.current?.postMessage({ action: "next" }); }, []);
  const handleToggle = useMemo(() => () => { ctrlBCRef.current?.postMessage({ action: "toggle-play" }); }, []);
  const handleSeek   = useMemo(() => (t: number) => { ctrlBCRef.current?.postMessage({ action: "seek", value: t }); }, []);
  const handleVolume = useMemo(() => (v: number) => { ctrlBCRef.current?.postMessage({ action: "volume", value: v }); }, []);

  const { track, isPlaying, progress, duration, volume } = state;

  const tier = size.width < 80  ? "nano"
             : size.width < 220 ? "micro"
             : size.width < 380 ? "compact"
             : "full";

  const notHovered = !hovered;

  const iconSm = Math.max(11, Math.min(14, Math.round(size.height * 0.20)));
  const iconMd = Math.max(12, Math.min(15, Math.round(size.height * 0.22)));
  const playR  = Math.max(12, Math.min(18, Math.round(size.height * 0.27)));
  const playRFull = Math.max(16, Math.min(22, Math.round(size.height * 0.31)));

  const artSize = (() => {
    if (tier === "nano")    return Math.max(size.width, size.height);
    if (tier === "micro")   return Math.max(20, Math.min(size.height - 4, Math.round(size.width * 0.32), 70));
    if (tier === "compact") return Math.max(20, Math.min(size.height - 4, 70));
    return Math.max(20, Math.min(size.height - 4, 96));
  })();

  const base = "w-screen h-screen bg-[#161410] overflow-hidden flex items-center relative select-none";

  // ─── Empty state ─────────────────────────────────────────────────────────────
  if (!track) {
    return (
      <div
        ref={rootRef}
        className={`${base} justify-center cursor-grab`}
        onMouseDown={startDrag}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <p className="text-[#3a3628] text-[10px] font-mono">Nothing playing</p>
        <div className="absolute top-1 right-1" onMouseDown={e => e.stopPropagation()}>
          <CtrlBtn onClick={handleClose} dimmed={notHovered} size={18}>
            {IcoClose(8)}
          </CtrlBtn>
        </div>
      </div>
    );
  }

  // ─── NANO (<80px wide) ──────────────────────────────────────────────────────
  if (tier === "nano") {
    const pct = duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;
    const nR = Math.max(10, Math.min(18, Math.round(Math.min(size.width, size.height) * 0.24)));
    return (
      <div
        ref={rootRef}
        className="w-screen h-screen overflow-hidden relative select-none"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="absolute inset-0 cursor-grab" onMouseDown={startDrag}>
          <ArtworkAtom path={track.path} size={artSize} />
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity duration-150"
          style={{ background: "rgba(0,0,0,0.58)", opacity: hovered ? 1 : 0, pointerEvents: "none" }}
        >
          <div style={{ pointerEvents: "auto" }} onMouseDown={e => e.stopPropagation()}>
            <PlayAtom isPlaying={isPlaying} radius={nR} onToggle={handleToggle} />
          </div>
        </div>
        <div
          className="absolute top-0.5 right-0.5 z-10 transition-opacity duration-150"
          style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            onClick={handleClose}
            className="flex items-center justify-center text-white/70 hover:text-white active:scale-90 transition-all"
            style={{ width: 16, height: 16 }}
          >
            {IcoClose(7)}
          </button>
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#2a2820] cursor-pointer z-10"
          onMouseDown={e => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            handleSeek(((e.clientX - r.left) / r.width) * duration);
          }}
        >
          <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  // ─── MICRO (80–220px wide) ──────────────────────────────────────────────────
  if (tier === "micro") {
    return (
      <div
        ref={rootRef}
        className={base}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="shrink-0 cursor-grab" onMouseDown={startDrag}>
          <ArtworkAtom path={track.path} size={artSize} />
        </div>
        <div className="flex-1 min-w-0 px-2 overflow-hidden cursor-grab" onMouseDown={startDrag}>
          <p className="text-[10px] text-[#f0ead8] truncate leading-tight">{track.title}</p>
        </div>
        <div
          className="flex items-center pr-1.5 shrink-0 gap-0.5"
          onMouseDown={e => e.stopPropagation()}
        >
          <PlayAtom isPlaying={isPlaying} radius={playR} onToggle={handleToggle} />
          <CtrlBtn onClick={handleClose} dimmed={notHovered} size={18}>
            {IcoClose(8)}
          </CtrlBtn>
        </div>
        <ProgressStrip progress={progress} duration={duration} onSeek={handleSeek} />
      </div>
    );
  }

  // ─── COMPACT (220–380px wide) ───────────────────────────────────────────────
  if (tier === "compact") {
    return (
      <div
        ref={rootRef}
        className={base}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="shrink-0 cursor-grab" onMouseDown={startDrag}>
          <ArtworkAtom path={track.path} size={artSize} />
        </div>
        <div className="flex-1 min-w-0 px-3 overflow-hidden cursor-grab" onMouseDown={startDrag}>
          <p className="text-xs text-[#f0ead8] truncate leading-snug font-medium">{track.title}</p>
          {size.height > 44 && (
            <p className="text-[10px] text-[#5a5448] truncate">{track.artist}</p>
          )}
        </div>
        <div
          className="flex items-center pr-2 shrink-0"
          onMouseDown={e => e.stopPropagation()}
        >
          <CtrlBtn onClick={handlePrev} dimmed={notHovered} size={iconMd + 8}>
            {IcoPrev(iconMd)}
          </CtrlBtn>
          <PlayAtom isPlaying={isPlaying} radius={playR} onToggle={handleToggle} />
          <CtrlBtn onClick={handleNext} dimmed={notHovered} size={iconMd + 8}>
            {IcoNext(iconMd)}
          </CtrlBtn>
          <CtrlBtn onClick={handleClose} dimmed={notHovered} size={18}>
            {IcoClose(9)}
          </CtrlBtn>
        </div>
        <ProgressStrip progress={progress} duration={duration} onSeek={handleSeek} />
      </div>
    );
  }

  // ─── FULL (380px+ wide) ─────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      className={base}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="shrink-0 cursor-grab" onMouseDown={startDrag}>
        <ArtworkAtom path={track.path} size={artSize} />
      </div>
      <div className="flex-1 min-w-0 px-3 overflow-hidden cursor-grab" onMouseDown={startDrag}>
        <p className="text-sm text-[#f0ead8] truncate leading-snug font-medium">{track.title}</p>
        {size.height > 44 && (
          <p className="text-xs text-[#5a5448] truncate">{track.artist}</p>
        )}
        {hovered && size.height > 58 && (
          <p className="text-[9px] text-[#3a3628] font-mono mt-0.5 tabular-nums">
            {fmt(progress)} / {fmt(duration)}
          </p>
        )}
      </div>
      <div
        className="flex items-center gap-0.5 pr-3 shrink-0"
        onMouseDown={e => e.stopPropagation()}
      >
        <CtrlBtn onClick={handlePrev} size={iconSm + 10}>
          {IcoPrev(iconSm)}
        </CtrlBtn>
        <PlayAtom isPlaying={isPlaying} radius={playRFull} onToggle={handleToggle} />
        <CtrlBtn onClick={handleNext} size={iconSm + 10}>
          {IcoNext(iconSm)}
        </CtrlBtn>
        {size.width > 500 && (
          <div className="flex items-center gap-1.5 ml-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            </svg>
            <input
              type="range" min="0" max="1" step="0.01"
              value={volume}
              onChange={(e) => handleVolume(parseFloat(e.target.value))}
              className="w-16 cursor-pointer"
              style={{ accentColor: "var(--accent)" }}
            />
          </div>
        )}
        <CtrlBtn onClick={handleClose} dimmed={notHovered} size={20}>
          {IcoClose(9)}
        </CtrlBtn>
      </div>
      <ProgressStrip progress={progress} duration={duration} onSeek={handleSeek} />
    </div>
  );
}
