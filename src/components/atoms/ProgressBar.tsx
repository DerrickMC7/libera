import { useState } from "react";

interface ProgressBarProps {
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
}

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ProgressBar({ progress, duration, onSeek }: ProgressBarProps) {
  // While dragging, the bar follows the pointer (dragPct) instead of playback;
  // the actual seek is committed on release.
  const [dragPct, setDragPct] = useState<number | null>(null);

  const livePct = duration > 0 ? (progress / duration) * 100 : 0;
  const pct = dragPct ?? livePct;
  const shownTime = dragPct !== null ? (dragPct / 100) * duration : progress;

  const pctFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  };

  return (
    <div className="flex items-center gap-3 w-full max-w-lg">
      <span className="text-[11px] font-mono text-[#3a3628] w-8 text-right">
        {formatTime(shownTime)}
      </span>
      <div
        className="flex-1 py-1.5 -my-1.5 cursor-pointer group touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragPct(pctFromEvent(e));
        }}
        onPointerMove={(e) => {
          if (dragPct !== null) setDragPct(pctFromEvent(e));
        }}
        onPointerUp={(e) => {
          if (dragPct === null) return;
          onSeek((pctFromEvent(e) / 100) * duration);
          setDragPct(null);
        }}
        onPointerCancel={() => setDragPct(null)}
      >
        <div className="h-1 bg-[#2a2820] rounded-full relative">
          <div
            className={`h-full bg-[var(--accent)] rounded-full ${dragPct === null ? "transition-all" : ""}`}
            style={{ width: `${pct}%` }}
          />
          {/* Scrub handle — visible on hover and while dragging */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[var(--accent)] shadow transition-opacity ${dragPct !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-[11px] font-mono text-[#3a3628] w-8">
        {formatTime(duration)}
      </span>
    </div>
  );
}
