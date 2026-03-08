import { motion } from "framer-motion";
import { Track } from "../../types/track";

interface TrackRowProps {
  track: Track;
  index: number;
  isActive: boolean;
  onClick: () => void;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TrackRow({ track, index, isActive, onClick }: TrackRowProps) {
  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className={`
        grid grid-cols-[2fr_1fr_1fr_80px] gap-4 px-4 py-3 rounded-lg cursor-pointer transition-colors
        ${isActive
          ? "bg-[rgba(212,135,42,0.08)] text-[#d4872a]"
          : "hover:bg-[#1f1d18]"
        }
      `}
    >
      <div className="min-w-0">
        <p className={`text-sm truncate ${isActive ? "text-[#d4872a]" : "text-[#f0ead8]"}`}>
          {track.title}
        </p>
        {track.track_number && (
          <p className="text-xs text-[#3a3628] mt-0.5">#{track.track_number}</p>
        )}
      </div>
      <p className="text-sm text-[#7a7060] truncate self-center">{track.artist}</p>
      <p className="text-sm text-[#7a7060] truncate self-center">{track.album}</p>
      <p className="text-sm text-[#7a7060] text-right self-center font-mono">
        {formatDuration(track.duration_secs)}
      </p>
    </motion.div>
  );
}