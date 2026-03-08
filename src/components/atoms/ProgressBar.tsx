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
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 w-full max-w-lg">
      <span className="text-[11px] font-mono text-[#3a3628] w-8 text-right">
        {formatTime(progress)}
      </span>
      <div
        className="flex-1 h-1 bg-[#2a2820] rounded-full cursor-pointer relative"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          onSeek(pct * duration);
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
  );
}