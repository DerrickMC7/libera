import { useState, useEffect, useRef, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Photo } from "../../types/photo";
import { usePhotoThumbnail } from "../../hooks/usePhotoThumbnail";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePhotoStore } from "../../store/photoStore";
import { useSetPhotoRating } from "../../hooks/usePhotos";
import { didDragOccur } from "../../lib/dragSelect";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

interface Props {
  photo: Photo;
  selected?: boolean;
  onClick?: () => void;
  onFavoriteToggle?: (e: React.MouseEvent) => void;
  onShiftSelect?: (path: string) => void;
  size?: number;
}

function StarRating({ rating, path, size = 12, interactive = false }: { rating: number; path: string; size?: number; interactive?: boolean }) {
  const [hoverRating, setHoverRating] = useState(0);
  const { mutate: setRating } = useSetPhotoRating();
  const { ratingOverrides, setRatingOverride } = usePhotoStore();
  const currentRating = path in ratingOverrides ? ratingOverrides[path] : rating;
  const effective = interactive && hoverRating > 0 ? hoverRating : currentRating;

  return (
    <div
      className={`flex gap-0.5 ${interactive ? "cursor-pointer" : ""}`}
      onMouseLeave={() => interactive && setHoverRating(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={star <= effective ? "var(--accent)" : "none"}
          stroke={star <= effective ? "var(--accent)" : "currentColor"}
          strokeWidth="1.5"
          className={interactive ? "transition-colors" : ""}
          onMouseEnter={() => interactive && setHoverRating(star)}
          onClick={(e) => {
            if (!interactive) return;
            e.stopPropagation();
            const newRating = star === currentRating ? 0 : star;
            setRatingOverride(path, newRating);
            setRating({ path, rating: newRating });
          }}
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

// Samples a 24×24 block from the top-right corner of an <img> (accounting for
// object-cover cropping) and returns the average perceived luminance (0–255).
// Returns -1 when the canvas is CORS-tainted or the image hasn't decoded yet.
function sampleTopRight(img: HTMLImageElement): number {
  try {
    const { naturalWidth: nw, naturalHeight: nh } = img;
    if (nw === 0 || nh === 0) return -1;
    const S = 24;
    const canvas = document.createElement("canvas");
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext("2d");
    if (!ctx) return -1;
    // Replicate object-cover: scale so the shorter display dimension is filled
    const dW = img.offsetWidth || nw;
    const dH = img.offsetHeight || nh;
    const scale = Math.max(dW / nw, dH / nh);
    const ox = (nw * scale - dW) / 2; // horizontal crop offset (scaled pixels)
    const oy = (nh * scale - dH) / 2; // vertical crop offset (scaled pixels)
    // Map the top-right S×S display block back to source coords
    const srcX = (dW - S + ox) / scale;
    const srcY = oy / scale;
    const srcW = S / scale;
    const srcH = S / scale;
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, S, S);
    const { data } = ctx.getImageData(0, 0, S, S);
    let lum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      lum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
    return n > 0 ? lum / n : -1;
  } catch {
    return -1; // CORS-tainted canvas
  }
}

function formatDate(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function PhotoContextMenu({
  photo, x, y, onClose, onFavoriteToggle, onRate, isFavorite,
}: {
  photo: Photo; x: number; y: number;
  onClose: () => void; onFavoriteToggle?: (e: React.MouseEvent) => void;
  onRate?: (rating: number) => void;
  isFavorite: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - w - 8), top: Math.min(y, window.innerHeight - h - 8) });
  }, [x, y]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copyPath() {
    navigator.clipboard.writeText(photo.path).then(() => {
      setCopied(true);
      setTimeout(onClose, 800);
    });
  }

  async function revealInExplorer() {
    if (IS_DEMO) { onClose(); return; }
    const { invoke } = await import("@tauri-apps/api/core");
    invoke("reveal_in_explorer", { path: photo.path }).catch(console.error);
    onClose();
  }

  async function openWithSystem() {
    if (IS_DEMO) { onClose(); return; }
    const { openPath } = await import("@tauri-apps/plugin-opener");
    openPath(photo.path).catch(console.error);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-[100]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.1 }}
        style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 110, minWidth: 200 }}
        className="bg-[#1a1814] border border-white/10 rounded-xl shadow-2xl py-1.5 px-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pt-1.5 pb-2 border-b border-white/5 mb-1.5">
          <p className="text-xs text-[#f0ead8] truncate font-medium">{photo.name}</p>
          <p className="text-[10px] text-[#5a5448] truncate mt-0.5">{photo.format.toUpperCase()} · {photo.width}×{photo.height}</p>
        </div>
        <button
          onClick={copyPath}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-left text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors"
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          )}
          {copied ? "Copied!" : "Copy path"}
        </button>
        {!IS_DEMO && (
          <button
            onClick={revealInExplorer}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-left text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            Show in folder
          </button>
        )}
        {!IS_DEMO && (
          <button
            onClick={openWithSystem}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-left text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Open with system viewer
          </button>
        )}
        <button
          onClick={(e) => { onFavoriteToggle?.(e); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-left text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className={isFavorite ? "text-[var(--accent)]" : ""}>
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
        </button>
        <div className="border-t border-white/5 mt-1.5 pt-1.5">
          <div className="px-3 py-1 flex items-center gap-1.5">
            <span className="text-[10px] text-[#3a3628] font-mono">Rate:</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => { onRate?.(star === photo.rating ? 0 : star); onClose(); }}
                className="transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24"
                  fill={star <= photo.rating ? "var(--accent)" : "none"}
                  stroke={star <= photo.rating ? "var(--accent)" : "#5a5244"}
                  strokeWidth="1.5"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </>
  );
}

export const PhotoCard = memo(function PhotoCard({ photo, selected, onClick, onFavoriteToggle, onShiftSelect, size = 200 }: Props) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // true = top-right corner of the thumbnail is light → use dark heart stroke
  const [heartOnLight, setHeartOnLight] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const { selectionMode, selectedPaths, toggleSelect, startSelection, favoriteOverrides, setFavoriteOverride, ratingOverrides } = usePhotoStore();
  const { mutate: setRating } = useSetPhotoRating();
  const isSelected = selectedPaths.has(photo.path);
  const isFavorite = photo.path in favoriteOverrides ? favoriteOverrides[photo.path] : photo.is_favorite;
  const iRating = photo.path in ratingOverrides ? ratingOverrides[photo.path] : photo.rating;
  const showStars = size >= 140;

  const { data: thumbUrl } = usePhotoThumbnail(photo.path);

  const displaySrc = thumbUrl
    ? thumbUrl
    : IS_DEMO
      ? photo.path
      : null;

  const aspectRatio = photo.width && photo.height ? photo.width / photo.height : 1;

  return (
    <>
    <div
      className="relative overflow-hidden rounded-lg cursor-pointer group"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        outline: (selected || isSelected) ? "2px solid var(--accent)" : undefined,
        outlineOffset: (selected || isSelected) ? "2px" : undefined,
      }}
      onClick={(e) => { if (selectionMode) { if (e.shiftKey) onShiftSelect?.(photo.path); else if (!didDragOccur()) toggleSelect(photo.path); } else onClick?.(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
    >
      {/* Image */}
      {displaySrc && !imgError ? (
        <img
          ref={imgRef}
          src={displaySrc}
          alt={photo.name}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={() => setImgError(true)}
          onLoad={() => {
            const lum = sampleTopRight(imgRef.current!);
            if (lum >= 0) setHeartOnLight(lum > 140);
          }}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[#1a1814]">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 15l5-5 4 4 2-2 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* Overlay on hover */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent transition-opacity duration-200"
        style={{ opacity: hovered || selected ? 1 : 0 }}
      />

      {/* Bottom info */}
      {hovered && (
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-white text-xs font-medium truncate leading-tight">{photo.name}</p>
          <div className="flex items-center justify-between mt-0.5">
            {(photo.date_taken || photo.date_modified) && (
              <p className="text-white/60 text-[10px]">{formatDate(photo.date_taken ?? photo.date_modified)}</p>
            )}
            {showStars && (
              <div className="ml-auto text-white/50" onClick={(e) => e.stopPropagation()}>
                <StarRating rating={photo.rating} path={photo.path} size={10} interactive />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Always-visible rating badge for rated photos */}
      {!hovered && iRating > 0 && showStars && (
        <div className="absolute bottom-2 left-2">
          <div className="flex gap-px">
            {Array.from({ length: iRating }).map((_, i) => (
              <svg key={i} width="8" height="8" viewBox="0 0 24 24" fill="var(--accent)" stroke="none">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ))}
          </div>
        </div>
      )}

      {/* Format badge */}
      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="bg-black/60 text-white/80 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded">
          {photo.format}
        </span>
      </div>

      {/* Selection checkbox */}
      {(selectionMode || hovered) && (
        <div
          className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${
            isSelected
              ? "bg-[var(--accent)] border-[var(--accent)]"
              : "bg-black/50 border-white/60"
          }`}
          onClick={(e) => { e.stopPropagation(); if (e.shiftKey && selectionMode) { onShiftSelect?.(photo.path); } else if (selectionMode) { if (!didDragOccur()) toggleSelect(photo.path); } else { startSelection(photo.path); } }}
        >
          {isSelected && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </div>
      )}

      {/* Favorite button — always visible when favorited, hover-reveal otherwise.
          Heart color adapts to the background luminance sampled on thumbnail load:
          light bg → dark stroke; dark bg → white stroke with subtle shadow. */}
      <button
        className={`absolute top-2 right-2 cursor-pointer transition-opacity ${isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        onClick={(e) => { setFavoriteOverride(photo.path, !isFavorite); onFavoriteToggle?.(e); }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill={isFavorite ? "var(--accent)" : "none"}
          stroke={isFavorite ? "var(--accent)" : heartOnLight ? "#1a1814" : "white"}
          strokeWidth="2"
          style={!isFavorite && !heartOnLight
            ? { filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.7))" }
            : undefined}
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>

      {/* Dimensions overlay */}
      {photo.width && photo.height && hovered && (
        <div className="absolute bottom-2 right-2">
          <span className="bg-black/60 text-white/60 text-[9px] font-mono px-1 py-0.5 rounded">
            {photo.width}×{photo.height}
          </span>
        </div>
      )}

      {/* GPS pin indicator */}
      {photo.gps_lat != null && !hovered && (
        <div className="absolute bottom-2 right-2 opacity-50">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
      )}
    </div>

    {/* Context menu */}
    <AnimatePresence>
      {ctxMenu && (
        <PhotoContextMenu
          photo={photo}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onFavoriteToggle={(e) => { setFavoriteOverride(photo.path, !isFavorite); onFavoriteToggle?.(e); }}
          onRate={(rating) => setRating({ path: photo.path, rating })}
          isFavorite={isFavorite}
        />
      )}
    </AnimatePresence>
    </>
  );
});
