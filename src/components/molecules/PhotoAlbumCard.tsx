import { useState, memo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhotoAlbum } from "../../types/photo";
import { usePhotoThumbnail } from "../../hooks/usePhotoThumbnail";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

interface Props {
  album: PhotoAlbum;
  onClick?: () => void;
}

function AlbumThumb({ path }: { path: string }) {
  const { data: thumbUrl } = usePhotoThumbnail(path);
  const [imgError, setImgError] = useState(false);
  const src = thumbUrl || (IS_DEMO ? path : null);
  if (!src || imgError) {
    return <div className="w-full h-full bg-[#1a1814]" />;
  }
  return (
    <img
      src={src}
      alt=""
      className="w-full h-full object-cover"
      onError={() => setImgError(true)}
      loading="lazy"
    />
  );
}

export const PhotoAlbumCard = memo(function PhotoAlbumCard({ album, onClick }: Props) {
  const covers = album.cover_paths ?? (album.cover_path ? [album.cover_path] : []);
  const showCollage = covers.length >= 4;
  const [isHovering, setIsHovering] = useState(false);
  const [cycleIdx, setCycleIdx] = useState(0);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (resetRef.current) { clearTimeout(resetRef.current); resetRef.current = null; }
    if (isHovering && covers.length > 1 && !showCollage) {
      cycleRef.current = setInterval(() => {
        setCycleIdx((i) => (i + 1) % covers.length);
      }, 700);
    } else {
      if (cycleRef.current) clearInterval(cycleRef.current);
      if (!isHovering) {
        resetRef.current = setTimeout(() => setCycleIdx(0), 600);
      }
    }
    return () => {
      if (cycleRef.current) clearInterval(cycleRef.current);
      if (resetRef.current) clearTimeout(resetRef.current);
    };
  }, [isHovering, covers.length, showCollage]);

  return (
    <div
      className="cursor-pointer group flex flex-col gap-2"
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="relative overflow-hidden rounded-xl aspect-square bg-[#1a1814] group-hover:ring-1 group-hover:ring-[var(--accent)]/30 transition-all">
        {showCollage ? (
          // 2×2 collage
          <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-px bg-[#0e0d0b] group-hover:scale-[1.02] transition-transform duration-300">
            {covers.slice(0, 4).map((p, i) => (
              <div key={i} className="overflow-hidden">
                <AlbumThumb path={p} />
              </div>
            ))}
          </div>
        ) : covers.length > 0 ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={covers[cycleIdx] ?? covers[0]}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <AlbumThumb path={covers[cycleIdx] ?? covers[0]} />
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="w-full h-full flex items-center justify-center group-hover:scale-[1.02] transition-transform duration-300">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
              <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="7.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 15l6-6 4 4 2-2 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {/* Gradient overlay (non-collage only, for subtlety) */}
        {!showCollage && covers.length > 0 && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        )}

        {/* Photo count badge */}
        <div className="absolute bottom-2 right-2">
          <span className="bg-black/60 text-white/80 text-xs font-mono px-2 py-0.5 rounded">
            {album.count}
          </span>
        </div>

        {/* Cycling dots (non-collage, multiple covers) */}
        {!showCollage && covers.length > 1 && isHovering && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {covers.slice(0, Math.min(covers.length, 6)).map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full transition-all"
                style={{ background: i === cycleIdx % Math.min(covers.length, 6) ? "white" : "rgba(255,255,255,0.3)" }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-1">
        <p className="text-[#f0ead8] text-sm font-medium truncate group-hover:text-[var(--accent)] transition-colors">{album.name}</p>
        <p className="text-[#5a5244] text-xs mt-0.5 truncate">
          {album.count} {album.count === 1 ? "photo" : "photos"}
          {album.folder_path.includes("/") || album.folder_path.includes("\\") ? (
            <span className="ml-1.5 text-[#3a3628]">
              · {album.folder_path.split(/[/\\]/).slice(0, -1).join(" / ")}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
});
