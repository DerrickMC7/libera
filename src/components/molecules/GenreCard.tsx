import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { Genre } from "../../types/genre";
import { Track } from "../../types/track";
import { useArtwork } from "../../hooks/useArtwork";
import { useGenreImage } from "../../hooks/useGenreImage";
import { usePlayerStore } from "../../store/playerStore";
import { GenreImageModal } from "../organisms/GenreImageModal";

interface GenreCardProps {
  genre: Genre;
  onClick: () => void;
}

export function GenreCard({ genre, onClick }: GenreCardProps) {
  const { data: genreImageUrl } = useGenreImage(genre.name);
  const { data: coverUrl } = useArtwork(genre.cover_path, true);
  const imageUrl = genreImageUrl ?? coverUrl;
  const queryClient = useQueryClient();

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  async function playGenre() {
    if (loadingPlay) return;
    setLoadingPlay(true);
    try {
      const tracks = await invoke<Track[]>("get_genre_tracks", {
        genre: genre.name,
        limit: 500,
        offset: 0,
      });
      if (tracks && tracks.length > 0) {
        const { setQueue, setIsPlaying } = usePlayerStore.getState();
        setQueue(tracks, 0);
        setIsPlaying(true);
      }
    } catch {
      // silent — playback failure is non-critical
    } finally {
      setLoadingPlay(false);
    }
  }

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
    const menuW = 168, menuH = 88; // 2 items
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ x, y });
  }

  async function handleReset() {
    setCtxMenu(null);
    try {
      await invoke("clear_genre_image_custom", { genreName: genre.name });
      queryClient.invalidateQueries({ queryKey: ["genre-image", genre.name] });
    } catch {
      // silent — non-critical
    }
  }

  return (
    <>
      <div className="w-full group" onContextMenu={handleContextMenu}>
        {/* Landscape tile — distinguishes genres from square albums & portrait artists */}
        <div className="relative w-full aspect-[3/2] rounded-xl overflow-hidden bg-[#1f1d18]">
          {/* Card body — opens the genre */}
          <button onClick={onClick} aria-label={genre.name} className="absolute inset-0 w-full h-full text-left">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={genre.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
            )}

            {/* Tint + bottom gradient for legible overlaid text */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{ background: "linear-gradient(to top, var(--accent-a30), transparent 55%)" }} />

            {/* Overlaid title + count */}
            <div className="absolute inset-x-0 bottom-0 px-4 pb-3.5">
              <p
                className="text-lg sm:text-xl font-light truncate leading-tight drop-shadow"
                style={{ fontFamily: "Fraunces, serif", color: "white" }}
              >
                {genre.name}
              </p>
              <p className="text-[11px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.72)" }}>
                {genre.track_count} {genre.track_count === 1 ? "track" : "tracks"}
              </p>
            </div>
          </button>

          {/* Centered play button — actually plays the genre (sibling of the card button) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button
              onClick={(e) => { e.stopPropagation(); playGenre(); }}
              disabled={loadingPlay}
              aria-label={`Play ${genre.name}`}
              className="w-12 h-12 rounded-full bg-[var(--accent)] flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all duration-150 hover:scale-105 disabled:opacity-100"
            >
              {loadingPlay ? (
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>
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
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
                Set genre image
              </button>
              <button
                onClick={handleReset}
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
            <GenreImageModal
              genreName={genre.name}
              onClose={() => setImageModalOpen(false)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
