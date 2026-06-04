import { Artist } from "../../types/artist";
import { useArtwork } from "../../hooks/useArtwork";
import { useArtistImage } from "../../hooks/useArtistImage";

interface ArtistCardProps {
  artist: Artist;
  onClick: () => void;
}

export function ArtistCard({ artist, onClick }: ArtistCardProps) {
  const { data: artistImageUrl } = useArtistImage(artist.name);
  const { data: albumArtUrl } = useArtwork(artist.cover_path, true);
  const imageUrl = artistImageUrl ?? albumArtUrl;

  return (
    <button onClick={onClick} className="flex flex-col text-left group w-full">
      {/* Portrait image — taller than wide, distinguishes it from square album cards */}
      <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-[#1f1d18]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={artist.name}
            className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        )}

        {/* Bottom gradient with overlaid text */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 px-3 pb-3">
          <p className="text-sm font-light text-white truncate leading-snug">
            {artist.name}
          </p>
          <p className="text-[11px] text-white/50 font-mono mt-0.5 truncate">
            {artist.album_count} {artist.album_count === 1 ? "album" : "albums"}
            {" · "}
            {artist.track_count} tracks
          </p>
        </div>

        {/* Hover play button */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div className="w-11 h-11 rounded-full bg-[var(--accent)] flex items-center justify-center shadow-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
    </button>
  );
}
