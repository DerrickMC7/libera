import { useArtistDetails } from "../../hooks/useArtists";
import { useArtwork } from "../../hooks/useArtwork";
import { useArtistImage } from "../../hooks/useArtistImage";
import { useArtistBanner } from "../../hooks/useArtistBanner";
import { usePlayerStore } from "../../store/playerStore";
import { useNavigationStore } from "../../store/navigationStore";
import { TrackRow } from "../molecules/TrackRow";
import { Artist } from "../../types/artist";
import { Track } from "../../types/track";

interface ArtistViewProps {
  artist: Artist;
  onBack: () => void;
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
  const navigateToAlbum = useNavigationStore((s) => s.navigateToAlbum);
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
      {/* Banner grows to image's natural size; max-h caps tall portrait fallbacks.
          The bottom gradient fades over the clip edge so the cut is invisible. */}
      <div className="relative w-full shrink-0 overflow-hidden max-h-[500px]">
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt={artist.name}
            className="w-full h-auto block"
            style={{ filter: "brightness(0.65)" }}
          />
        ) : (
          <div className="h-48 bg-[#1a1814]" />
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
            className="text-[48px] leading-none tracking-[-1.5px] font-light drop-shadow-xl"
            style={{ fontFamily: "Fraunces, serif", textShadow: "0 2px 16px rgba(0,0,0,0.7)", color: "white" }}
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
                <p
                  className="text-sm text-[#f0ead8] hover:text-[var(--accent)] cursor-pointer transition-colors"
                  style={{ fontFamily: "Georgia, serif" }}
                  onClick={() => navigateToAlbum(albumData.album, artist.name)}
                >
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
                <TrackRow
                  key={track.path}
                  track={track}
                  isActive={currentTrack?.path === track.path}
                  onClick={() => handlePlayTrack(track, albumData.tracks)}
                  showTrackNumber
                  showArtwork={false}
                  showArtistColumn={false}
                  trackNumber={track.track_number ?? idx + 1}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}