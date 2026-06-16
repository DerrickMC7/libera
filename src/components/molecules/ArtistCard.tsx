import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { Artist } from "../../types/artist";
import { useArtwork } from "../../hooks/useArtwork";
import { useArtistImage } from "../../hooks/useArtistImage";
import { ArtistImageModal } from "../organisms/ArtistImageModal";

interface ArtistCardProps {
  artist: Artist;
  onClick: () => void;
}

export function ArtistCard({ artist, onClick }: ArtistCardProps) {
  const { data: artistImageUrl } = useArtistImage(artist.name);
  const { data: albumArtUrl } = useArtwork(artist.cover_path, true);
  const imageUrl = artistImageUrl ?? albumArtUrl;
  const queryClient = useQueryClient();

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setCtxMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    // Lock scroll on the whole page while the menu is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.body.style.overflow = prev;
    };
  }, [ctxMenu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const menuW = 168, menuH = 112; // 3 items always visible
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ x, y });
  }

  async function handleResetImage() {
    setCtxMenu(null);
    try {
      await invoke("clear_artist_image_custom", { artistName: artist.name });
      queryClient.invalidateQueries({ queryKey: ["artist-image", artist.name] });
      queryClient.invalidateQueries({ queryKey: ["artist-image-custom", artist.name] });
    } catch {
      // silent — non-critical
    }
  }

  async function handleFetchFromDb() {
    setCtxMenu(null);
    setFetching(true);
    try {
      await invoke("fetch_single_artist_image", { artistName: artist.name });
      queryClient.invalidateQueries({ queryKey: ["artist-image", artist.name] });
      queryClient.invalidateQueries({ queryKey: ["artist-image-custom", artist.name] });
    } catch {
      // silent — network may be unavailable
    } finally {
      setFetching(false);
    }
  }

  return (
    <>
      <div className="w-full" onContextMenu={handleContextMenu}>
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
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />

            <div className="absolute inset-x-0 bottom-0 px-3 pb-3">
              <p className="text-sm font-light truncate leading-snug drop-shadow" style={{ color: "white" }}>
                {artist.name}
              </p>
              <p className="text-[11px] font-mono mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.8)" }}>
                {artist.album_count} {artist.album_count === 1 ? "album" : "albums"}
                {" · "}
                {artist.track_count} tracks
              </p>
            </div>

            {/* Hover play button */}
            {!fetching && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <div className="w-11 h-11 rounded-full bg-[var(--accent)] flex items-center justify-center shadow-xl">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            )}

            {/* Fetch-in-progress overlay */}
            {fetching && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
              </div>
            )}
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
            onClick={() => { setCtxMenu(null); setImageModalOpen(true); }}
            className="w-full text-left px-3 py-2 text-xs text-[#c8bfa8] hover:bg-white/5 transition-colors font-mono flex items-center gap-2.5"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-[#7a7060]">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            Set artist image
          </button>
          <button
            onClick={handleFetchFromDb}
            className="w-full text-left px-3 py-2 text-xs text-[#c8bfa8] hover:bg-white/5 transition-colors font-mono flex items-center gap-2.5"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-[#7a7060]">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14l-4-4h3V9h2v4h3l-4 4z"/>
            </svg>
            Fetch from database
          </button>
          <button
            onClick={handleResetImage}
            className="w-full text-left px-3 py-2 text-xs text-[#7a7060] hover:bg-white/5 hover:text-[#c8bfa8] transition-colors font-mono flex items-center gap-2.5"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
              <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
            Reset to auto
          </button>
        </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Image crop modal — portaled to body for the same reason */}
      {createPortal(
        <AnimatePresence>
          {imageModalOpen && (
            <ArtistImageModal
              artistName={artist.name}
              onClose={() => setImageModalOpen(false)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
