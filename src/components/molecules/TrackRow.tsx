import { motion } from "framer-motion";
import { Track } from "../../types/track";
import { useArtwork } from "../../hooks/useArtwork";

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
  const { data: artworkUrl } = useArtwork(track.path);

  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className={`
        grid grid-cols-[2fr_1fr_1fr_80px] gap-4 px-4 py-3 rounded-lg cursor-pointer transition-colors
        ${isActive
          ? "bg-[rgba(212,135,42,0.08)]"
          : "hover:bg-[#1f1d18]"
        }
      `}
    >
      <div className="min-w-0 flex items-center gap-3">
        {/* Artwork thumbnail */}
        <div className="w-8 h-8 rounded bg-[#2a2820] shrink-0 overflow-hidden">
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt={track.album}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-sm truncate ${isActive ? "text-[#d4872a]" : "text-[#f0ead8]"}`}>
            {track.title}
          </p>
          {track.track_number && (
            <p className="text-xs text-[#3a3628] mt-0.5">#{track.track_number}</p>
          )}
        </div>
      </div>
      <p className="text-sm text-[#7a7060] truncate self-center">{track.artist}</p>
      <p className="text-sm text-[#7a7060] truncate self-center">{track.album}</p>
      <p className="text-sm text-[#7a7060] text-right self-center font-mono">
        {formatDuration(track.duration_secs)}
      </p>
    </motion.div>
  );
}