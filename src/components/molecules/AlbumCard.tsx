import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Album } from "../../types/album";
import { useArtwork } from "../../hooks/useArtwork";
import { AlbumCoverModal } from "../organisms/AlbumCoverModal";

interface AlbumCardProps {
  album: Album;
  onClick: () => void;
}

export function AlbumCard({ album, onClick }: AlbumCardProps) {
  const { data: artworkUrl } = useArtwork(album.cover_path, true);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setCtxMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCtxMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Lock scroll on the whole page while the menu is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [ctxMenu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const menuW = 168, menuH = 44; // single item
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ x, y });
  }

  return (
    <>
      <div className="w-full" onContextMenu={handleContextMenu}>
        <button
          onClick={onClick}
          className="flex flex-col gap-2.5 text-left group w-full"
        >
          <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-[#1f1d18]">
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={album.album}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-150 flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center shadow-lg">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-sm text-[#f0ead8] truncate leading-snug group-hover:text-[var(--accent)] transition-colors duration-150">
              {album.album}
            </p>
            <p className="text-xs text-[#7a7060] truncate mt-0.5">
              {album.artist}{album.year ? ` · ${album.year}` : ""}
            </p>
            <p className="text-xs text-[#3a3628] mt-0.5">
              {album.track_count} {album.track_count === 1 ? "track" : "tracks"}
            </p>
          </div>
        </button>
      </div>

      {/* Context menu — portaled to body to escape virtualizer transform stacking context */}
      {createPortal(
        <AnimatePresence>
          {ctxMenu && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.1 }}
              className="fixed z-[200] bg-[#1a1814] border border-white/10 rounded-xl shadow-2xl py-1 min-w-[168px]"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
            >
              <button
                onClick={() => { setCtxMenu(null); setCoverModalOpen(true); }}
                className="w-full text-left px-3 py-2 text-xs text-[#c8bfa8] hover:bg-white/5 transition-colors font-mono flex items-center gap-2.5"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-[#7a7060]">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
                Change cover…
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Cover crop modal — portaled to body for the same reason */}
      {createPortal(
        <AnimatePresence>
          {coverModalOpen && (
            <AlbumCoverModal
              album={album}
              onClose={() => setCoverModalOpen(false)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
