import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { usePlayerStore } from "../../store/playerStore";

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer() {
  const { progress, duration, seek } = useAudioPlayer();
  const {
    currentTrack,
    isPlaying,
    volume,
    setIsPlaying,
    setVolume,
    nextTrack,
    previousTrack,
  } = usePlayerStore();

  if (!currentTrack) return null;

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#161410] border-t border-white/5 flex items-center px-6 gap-6 z-50">
      {/* Track info */}
      <div className="flex flex-col min-w-0 w-56">
        <p className="text-sm text-[#f0ead8] truncate">{currentTrack.title}</p>
        <p className="text-xs text-[#7a7060] truncate">{currentTrack.artist}</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center flex-1 gap-2">
        <div className="flex items-center gap-6">
          {/* Previous */}
          <button
            onClick={previousTrack}
            className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-9 h-9 rounded-full bg-[#f0ead8] flex items-center justify-center hover:bg-white transition-colors"
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#0e0d0b">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#0e0d0b">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Next */}
          <button
            onClick={nextTrack}
            className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zm2.5-6 8.5 6V6z" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3 w-full max-w-lg">
          <span className="text-[11px] font-mono text-[#3a3628] w-8 text-right">
            {formatTime(progress)}
          </span>
          <div
            className="flex-1 h-1 bg-[#2a2820] rounded-full cursor-pointer relative group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              seek(pct * duration);
            }}
          >
            <div
              className="h-full bg-[#d4872a] rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-[#3a3628] w-8">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 w-32">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="text-[#7a7060]"
        >
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        </svg>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="flex-1 accent-[#d4872a] cursor-pointer"
        />
      </div>
    </div>
  );
}