import { motion } from "framer-motion";
import { Album } from "../../types/album";
import { useArtwork } from "../../hooks/useArtwork";

interface AlbumCardProps {
  album: Album;
  onClick: () => void;
}

export function AlbumCard({ album, onClick }: AlbumCardProps) {
  const { data: artworkUrl } = useArtwork(album.cover_path, true);

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col gap-2.5 text-left group w-full"
    >
      {/* Cover art */}
      <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-[#1f1d18]">
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt={album.album}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 w-10 h-10 rounded-full bg-[#d4872a] flex items-center justify-center shadow-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="min-w-0">
        <p className="text-sm text-[#f0ead8] truncate leading-snug group-hover:text-[#d4872a] transition-colors">
          {album.album}
        </p>
        <p className="text-xs text-[#7a7060] truncate mt-0.5">
          {album.artist}
          {album.year ? ` · ${album.year}` : ""}
        </p>
        <p className="text-xs text-[#3a3628] mt-0.5">
          {album.track_count} {album.track_count === 1 ? "track" : "tracks"}
        </p>
      </div>
    </motion.button>
  );
}