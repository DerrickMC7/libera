import { useState } from "react";
import { motion } from "framer-motion";
import { Track } from "../../types/track";
import { useArtwork } from "../../hooks/useArtwork";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";

interface TrackRowProps {
  track: Track;
  index: number;
  isActive: boolean;
  onClick: () => void;
  showAlbum?: boolean;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TrackRow({ track, index, isActive, onClick, showAlbum = true }: TrackRowProps) {
  const { data: artworkUrl } = useArtwork(track.path);
  const [hovered, setHovered] = useState(false);
  const { playNext, addToQueue } = usePlayerStore();
  const { show: showToast } = useToastStore();

  return (
    <motion.div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      className={`
        grid ${showAlbum ? "grid-cols-[2fr_1fr_1fr_120px]" : "grid-cols-[2fr_1fr_120px]"} gap-4 px-4 h-14 items-center rounded-lg cursor-pointer transition-colors
        ${isActive ? "bg-[var(--accent-a08)]" : "hover:bg-[#1f1d18]"}
      `}
    >
      <div className="min-w-0 flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#2a2820] shrink-0 overflow-hidden">
          {artworkUrl ? (
            <img src={artworkUrl} alt={track.album} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-sm truncate ${isActive ? "text-[var(--accent)]" : "text-[#f0ead8]"}`} title={track.title}>
            {track.title}
          </p>
          {track.track_number && (
            <p className="text-xs text-[#3a3628] mt-0.5">#{track.track_number}</p>
          )}
        </div>
      </div>
      <p className="text-sm text-[#7a7060] truncate self-center" title={track.artist}>{track.artist}</p>
      {showAlbum && (
        <p className="text-sm text-[#7a7060] truncate self-center" title={track.album}>{track.album}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        {hovered && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); addToQueue(track); showToast(`Added to queue — ${track.title}`); }}
              title="Add to queue"
              className="p-2 rounded-md text-[#7a7060] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"/>
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); playNext(track); showToast(`Playing next — ${track.title}`); }}
              title="Play next"
              className="p-2 rounded-md text-[#7a7060] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
              </svg>
            </button>
          </>
        )}
        <span className="text-sm text-[#7a7060] font-mono w-10 text-right">
          {formatDuration(track.duration_secs)}
        </span>
      </div>
    </motion.div>
  );
}
