import { useState } from "react";
import { useArtistDetails } from "../../hooks/useArtists";
import { useArtwork } from "../../hooks/useArtwork";
import { useArtistImage } from "../../hooks/useArtistImage";
import { useArtistBanner } from "../../hooks/useArtistBanner";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { Artist } from "../../types/artist";
import { Track } from "../../types/track";

function ArtistTrackRow({ track, idx, isActive, onClick }: {
  track: Track; idx: number; isActive: boolean; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { playNext, addToQueue } = usePlayerStore();
  const { show: showToast } = useToastStore();
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`w-full grid grid-cols-[24px_1fr_120px] gap-3 px-3 h-11 items-center rounded-lg cursor-pointer transition-colors ${
        isActive ? "bg-[var(--accent-a08)]" : "hover:bg-[#1f1d18]"
      }`}
    >
      <span className={`text-xs font-mono self-center ${isActive ? "text-[var(--accent)]" : "text-[#3a3628]"}`}>
        {track.track_number ?? idx + 1}
      </span>
      <span className={`text-sm truncate self-center ${isActive ? "text-[var(--accent)]" : "text-[#f0ead8]"}`} title={track.title}>
        {track.title}
      </span>
      <div className="flex items-center justify-end gap-2 self-center">
        {hovered && (
          <>
            <button onClick={(e) => { e.stopPropagation(); addToQueue(track); showToast(`Added to queue — ${track.title}`); }}
              title="Add to queue"
              className="p-2 rounded-md text-[#7a7060] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"/>
              </svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); playNext(track); showToast(`Playing next — ${track.title}`); }}
              title="Play next"
              className="p-2 rounded-md text-[#7a7060] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
              </svg>
            </button>
          </>
        )}
        <span className="text-xs font-mono text-[#3a3628] w-10 text-right">
          {formatDuration(track.duration_secs)}
        </span>
      </div>
    </div>
  );
}

interface ArtistViewProps {
  artist: Artist;
  onBack: () => void;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AlbumCover({ path }: { path: string }) {
  const { data: artworkUrl } = useArtwork(path, true);
  return (
    <div className="w-10 h-10 rounded bg-[#1f1d18] shrink-0 overflow-hidden">
      {artworkUrl ? (
        <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function ArtistView({ artist, onBack }: ArtistViewProps) {
  const { data: albums = [], isLoading } = useArtistDetails(artist.name);
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const { data: artistBannerUrl } = useArtistBanner(artist.name);
  const { data: artistImageUrl } = useArtistImage(artist.name);
  const { data: fallbackArtworkUrl } = useArtwork(artist.cover_path, true);
  // Prefer dedicated wide banner, then portrait thumb, then embedded album art
  const bannerUrl = artistBannerUrl ?? artistImageUrl ?? fallbackArtworkUrl;
  const isWideBanner = !!artistBannerUrl;

  // Flatten all tracks for play all
  const allTracks = albums.flatMap((a) => a.tracks);

  function handlePlayAll() {
    if (allTracks.length === 0) return;
    setQueue(allTracks, 0);
    setIsPlaying(true);
  }

  function handlePlayTrack(track: Track, albumTracks: Track[]) {
    const index = albumTracks.indexOf(track);
    setQueue(albumTracks, index);
    setIsPlaying(true);
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b] overflow-y-auto">
      {/* Artist banner */}
      <div className="relative w-full h-64 shrink-0 overflow-hidden">
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt={artist.name}
            className={`w-full h-full object-cover ${isWideBanner ? "object-center" : "object-top scale-105"}`}
            style={{ filter: isWideBanner ? "brightness(0.7)" : "blur(2px) brightness(0.7)" }}
          />
        ) : (
          <div className="w-full h-full bg-[#1a1814]" />
        )}

        {/* Gradient: dark top (for back button legibility) + fade-to-bg at bottom */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/10 to-[#0e0d0b]" />

        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-5 left-8 flex items-center gap-1.5 text-[#c8bfa8]/80 hover:text-[#c8bfa8] transition-colors text-xs font-mono z-10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          Artists
        </button>

        {/* Artist name pinned to bottom of banner */}
        <div className="absolute bottom-6 left-10 z-10">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-2">Artist</p>
          <h1
            className="text-[48px] leading-none tracking-[-1.5px] text-white font-light drop-shadow-xl"
            style={{ fontFamily: "Fraunces, serif", textShadow: "0 2px 16px rgba(0,0,0,0.7)" }}
          >
            {artist.name}
          </h1>
        </div>
      </div>

      {/* Stats + play all */}
      <div className="px-10 pt-5 pb-6">
        <div className="flex items-center gap-5">
          <button
            onClick={handlePlayAll}
            className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono tracking-widest uppercase px-5 py-2.5 rounded-full transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play all
          </button>
          <p className="text-[#3a3628] text-xs font-mono">
            {artist.album_count} {artist.album_count === 1 ? "album" : "albums"} · {artist.track_count} tracks
          </p>
        </div>
        <div className="border-t border-white/6 mt-5" />
      </div>

      {/* Albums and tracks */}
      <div className="px-10 pb-8">
        {isLoading && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <div className="h-4 rounded bg-[#1f1d18] animate-pulse w-48 mb-3" />
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-10 rounded bg-[#1a1814] animate-pulse mb-1" />
                ))}
              </div>
            ))}
          </div>
        )}

        {albums.map((albumData) => (
          <div key={albumData.album} className="mb-8">
            {/* Album header */}
            <div className="flex items-center gap-3 mb-3">
              <AlbumCover path={albumData.cover_path} />
              <div>
                <p className="text-sm text-[#f0ead8]" style={{ fontFamily: "Georgia, serif" }}>
                  {albumData.album}
                </p>
                <p className="text-xs text-[#3a3628] font-mono">
                  {albumData.year ?? "Unknown year"} · {albumData.track_count} tracks
                </p>
              </div>
            </div>

            {/* Track list */}
            <div className="border-t border-white/5">
              {albumData.tracks.map((track, idx) => (
                <ArtistTrackRow
                  key={track.path}
                  track={track}
                  idx={idx}
                  isActive={currentTrack?.path === track.path}
                  onClick={() => handlePlayTrack(track, albumData.tracks)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}