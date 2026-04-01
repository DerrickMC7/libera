import { Artist } from "../../types/artist";
import { useArtwork } from "../../hooks/useArtwork";

interface ArtistCardProps {
  artist: Artist;
  onClick: () => void;
}

export function ArtistCard({ artist, onClick }: ArtistCardProps) {
  const { data: artworkUrl } = useArtwork(artist.cover_path, true);

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-2.5 text-left group"
    >
      <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-[#1f1d18]">
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt={artist.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-150 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 w-10 h-10 rounded-full bg-[#d4872a] flex items-center justify-center shadow-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-sm text-[#f0ead8] truncate leading-snug group-hover:text-[#d4872a] transition-colors duration-150">
          {artist.name}
        </p>
        <p className="text-xs text-[#7a7060] truncate mt-0.5">
          {artist.album_count} albums
        </p>
        <p className="text-xs text-[#3a3628] mt-0.5">
          {artist.track_count} tracks
        </p>
      </div>
    </button>
  );
}

