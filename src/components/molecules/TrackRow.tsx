import { useState } from "react";
import { Track } from "../../types/track";
import { useArtwork } from "../../hooks/useArtwork";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { useContextMenuStore } from "../../store/contextMenuStore";
import { useNavigationStore } from "../../store/navigationStore";
import { ArtistLinks } from "../atoms/ArtistLinks";
import { useIsMobile } from "../../hooks/useIsMobile";

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Thumb({ path }: { path: string }) {
  const { data: url } = useArtwork(path, false, true);
  return url ? (
    <img src={url} alt="" className="w-full h-full object-cover" />
  ) : (
    <div className="w-full h-full flex items-center justify-center">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
    </div>
  );
}

// ─── Column config ─────────────────────────────────────────────────────────────

export interface TrackColConfig {
  showDragHandle?: boolean;   // 20px — playlist/queue drag grip
  showTrackNumber?: boolean;  // 32px — track index (artist view)
  showArtwork?: boolean;      // 36px — thumbnail. default: true
  showArtistColumn?: boolean; // 1fr  — artist as own column; false = subtitle. default: true
  showAlbumColumn?: boolean;  // 1fr  — album as own column. default: false
}

export function trackRowColumns({
  showDragHandle = false,
  showTrackNumber = false,
  showArtwork = true,
  showArtistColumn = true,
  showAlbumColumn = false,
}: TrackColConfig = {}): string {
  return [
    showDragHandle  && "16px",
    showTrackNumber && "32px",
    showArtwork     && "36px",
    "2fr",
    showArtistColumn && "1fr",
    showAlbumColumn  && "1fr",
    "100px",
  ].filter(Boolean).join(" ");
}

// ─── TrackRow ──────────────────────────────────────────────────────────────────

export interface TrackRowProps extends TrackColConfig {
  track: Track;
  isActive?: boolean;
  trackNumber?: number;
  playlistId?: number;
  draggable?: boolean;
  isDragging?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDragEnd?: () => void;
}

export function TrackRow({
  track,
  isActive = false,
  showDragHandle = false,
  showTrackNumber = false,
  showArtwork = true,
  showArtistColumn = true,
  showAlbumColumn = false,
  trackNumber,
  playlistId,
  draggable = false,
  isDragging = false,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TrackRowProps) {
  const [hovered, setHovered] = useState(false);
  const isMobile = useIsMobile();
  const effectiveShowArtistColumn = showArtistColumn && !isMobile;
  const effectiveShowAlbumColumn = showAlbumColumn && !isMobile;
  const { playNext, addToQueue } = usePlayerStore();
  const { show: showToast } = useToastStore();
  const showContextMenu = useContextMenuStore((s) => s.show);
  const navigateToAlbum = useNavigationStore((s) => s.navigateToAlbum);

  const displayNum = trackNumber ?? track.track_number;

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={isActive}
      aria-label={`${track.title} by ${track.artist}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      onContextMenu={(e) => { e.preventDefault(); showContextMenu(track, e.clientX, e.clientY, playlistId); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`grid h-12 items-center gap-3 px-4 rounded-lg cursor-pointer select-none transition-colors ${
        isActive ? "bg-[var(--accent-a08)]" : "hover:bg-[#1f1d18]"
      } ${isDragging ? "opacity-40" : ""}`}
      style={{ gridTemplateColumns: trackRowColumns({ showDragHandle, showTrackNumber, showArtwork, showArtistColumn: effectiveShowArtistColumn, showAlbumColumn: effectiveShowAlbumColumn }) }}
    >
      {/* Drag handle */}
      {showDragHandle && (
        <div className="flex items-center justify-center text-[#2a2820] group-hover:text-[#5a5448] hover:text-[#5a5448] pointer-events-none select-none">
          <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor" style={{ display: "block" }}>
            <circle cx="3" cy="2"  r="1.5"/>
            <circle cx="7" cy="2"  r="1.5"/>
            <circle cx="3" cy="6"  r="1.5"/>
            <circle cx="7" cy="6"  r="1.5"/>
            <circle cx="3" cy="10" r="1.5"/>
            <circle cx="7" cy="10" r="1.5"/>
          </svg>
        </div>
      )}

      {/* Track number */}
      {showTrackNumber && (
        <span className={`text-xs font-mono text-right ${isActive ? "text-[var(--accent)]" : "text-[#3a3628]"}`}>
          {displayNum ?? ""}
        </span>
      )}

      {/* Artwork */}
      {showArtwork && (
        <div className="w-9 h-9 rounded-md bg-[#1a1814] overflow-hidden shrink-0">
          <Thumb path={track.path} />
        </div>
      )}

      {/* Title + optional artist subtitle */}
      <div className="min-w-0">
        <p className={`text-sm leading-snug truncate ${isActive ? "text-[var(--accent)]" : "text-[#f0ead8]"}`}>
          {track.title}
        </p>
        {!effectiveShowArtistColumn && (
          <p className="text-[11px] text-[#5a5448] truncate">{track.artist}</p>
        )}
      </div>

      {/* Artist column */}
      {effectiveShowArtistColumn && (
        <p className="text-sm text-[#7a7060] truncate">
          <ArtistLinks artist={track.artist} />
        </p>
      )}

      {/* Album column */}
      {effectiveShowAlbumColumn && (
        <p
          className="text-sm text-[#7a7060] truncate hover:text-[var(--accent)] cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album, track.album_artist); }}
        >
          {track.album}
        </p>
      )}

      {/* Duration + hover actions */}
      <div className="flex items-center justify-end gap-1.5">
        {hovered && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); addToQueue(track); showToast(`Added to queue — ${track.title}`); }}
              aria-label="Add to queue"
              className="p-1.5 rounded-md text-[#7a7060] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"/>
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); playNext(track); showToast(`Playing next — ${track.title}`); }}
              aria-label="Play next"
              className="p-1.5 rounded-md text-[#7a7060] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
              </svg>
            </button>
          </>
        )}
        <span className={`text-xs font-mono w-10 text-right ${isActive ? "text-[var(--accent)]" : "text-[#5a5448]"}`}>
          {fmt(track.duration_secs)}
        </span>
      </div>
    </div>
  );
}

// ─── Column header row ─────────────────────────────────────────────────────────

export function TrackRowHeader(config: TrackColConfig = {}) {
  const {
    showDragHandle = false,
    showTrackNumber = false,
    showArtwork = true,
    showArtistColumn = true,
    showAlbumColumn = false,
  } = config;
  return (
    <div
      className="grid px-4 pb-2 mb-1 text-[10px] font-mono tracking-widest uppercase text-[#2a2820] border-b border-white/5"
      style={{ gridTemplateColumns: trackRowColumns(config) }}
    >
      {showDragHandle  && <span />}
      {showTrackNumber && <span className="text-right">#</span>}
      {showArtwork     && <span />}
      <span>Title</span>
      {showArtistColumn && <span>Artist</span>}
      {showAlbumColumn  && <span>Album</span>}
      <span className="text-right">Time</span>
    </div>
  );
}
