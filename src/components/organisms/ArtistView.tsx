import { useArtistDetails } from "../../hooks/useArtists";
import { useArtwork } from "../../hooks/useArtwork";
import { usePlayerStore } from "../../store/playerStore";
import { Artist } from "../../types/artist";
import { Track } from "../../types/track";

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
  const { data: artworkUrl } = useArtwork(artist.cover_path, true);

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
      {/* Header */}
      <div className="px-10 pt-9 pb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors mb-8 text-xs font-mono"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          Artists
        </button>

        {/* Artist hero */}
        <div className="flex gap-6 items-end mb-8">
          <div className="w-32 h-32 rounded-full overflow-hidden bg-[#1f1d18] shrink-0 shadow-xl">
            {artworkUrl ? (
              <img src={artworkUrl} alt={artist.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 pb-1">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1">Artist</p>
            <h1
              className="text-[32px] leading-none tracking-[-1px] text-[#faf8f2] font-light"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              {artist.name}
            </h1>
            <p className="text-[#3a3628] text-xs font-mono mt-1">
              {artist.album_count} {artist.album_count === 1 ? "album" : "albums"} · {artist.track_count} tracks
            </p>
            <button
              onClick={handlePlayAll}
              className="mt-3 flex items-center gap-2 bg-[#d4872a] hover:bg-[#e8a84c] text-white text-xs font-mono tracking-widest uppercase px-5 py-2.5 rounded-full transition-colors w-fit"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play all
            </button>
          </div>
        </div>

        <div className="border-t border-white/6" />
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
                <button
                  key={track.path}
                  onClick={() => handlePlayTrack(track, albumData.tracks)}
                  className={`w-full grid grid-cols-[24px_1fr_80px] gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[#1f1d18] ${
                    currentTrack?.path === track.path ? "bg-[rgba(212,135,42,0.08)]" : ""
                  }`}
                >
                  <span className={`text-xs font-mono self-center ${
                    currentTrack?.path === track.path ? "text-[#d4872a]" : "text-[#3a3628]"
                  }`}>
                    {track.track_number ?? idx + 1}
                  </span>
                  <span className={`text-sm truncate self-center ${
                    currentTrack?.path === track.path ? "text-[#d4872a]" : "text-[#f0ead8]"
                  }`}>
                    {track.title}
                  </span>
                  <span className="text-xs font-mono text-[#3a3628] self-center text-right">
                    {formatDuration(track.duration_secs)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}