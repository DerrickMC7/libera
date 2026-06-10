import { useRef, useCallback, useState, useEffect, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Photo } from "../../types/photo";
import { PhotoCard } from "../molecules/PhotoCard";
import { usePhotoStore } from "../../store/photoStore";
import { useTogglePhotoFavorite, useSetPhotoRating } from "../../hooks/usePhotos";
import { usePhotoThumbnail } from "../../hooks/usePhotoThumbnail";
import { convertFileSrc } from "@tauri-apps/api/core";
import { onCardPointerDown, onDocumentPointerMove, onDocumentPointerUp, onDocumentClickCapture, didDragOccur } from "../../lib/dragSelect";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);
const GAP = 8;

interface Props {
  photos: Photo[];
  total: number;
  onLoadMore?: () => void;
  loading?: boolean;
  emptyMessage?: string;
  cardSize?: number;
  layout?: "grid" | "list" | "masonry";
}

function SkeletonCard({ size }: { size: number }) {
  return (
    <div
      className="rounded-lg bg-[#1a1814] animate-pulse shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const LIST_ROW_H = 52;

const PhotoListRow = memo(function PhotoListRow({
  photo,
  index,
  allPhotos,
  onShiftSelect,
}: {
  photo: Photo;
  index: number;
  allPhotos: Photo[];
  onShiftSelect?: (path: string) => void;
}) {
  const { openLightbox, selectionMode, selectedPaths, toggleSelect, startSelection, favoriteOverrides, setFavoriteOverride, ratingOverrides, setRatingOverride } = usePhotoStore();
  const { mutate: toggleFavorite } = useTogglePhotoFavorite();
  const { mutate: setRating } = useSetPhotoRating();
  const isSelected = selectedPaths.has(photo.path);
  const isFavorite = photo.path in favoriteOverrides ? favoriteOverrides[photo.path] : photo.is_favorite;
  const iRating = photo.path in ratingOverrides ? ratingOverrides[photo.path] : photo.rating;
  const [rowHovered, setRowHovered] = useState(false);
  const { data: thumbUrl } = usePhotoThumbnail(photo.path);

  const thumbSrc = thumbUrl ?? (IS_DEMO ? photo.path : convertFileSrc(photo.path));
  const dateTaken = photo.date_taken ?? photo.date_modified;

  return (
    <div
      className={`flex items-center gap-4 px-10 py-2 cursor-pointer group hover:bg-white/4 transition-colors ${isSelected ? "bg-[var(--accent-a10)]" : ""}`}
      style={{ height: LIST_ROW_H }}
      data-photo-path={photo.path}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      onPointerDown={(e) => onCardPointerDown(e.nativeEvent, photo.path)}
      onClick={(e) => { if (selectionMode) { if (e.shiftKey) onShiftSelect?.(photo.path); else if (!didDragOccur()) toggleSelect(photo.path); } else openLightbox(allPhotos, index); }}
    >
      {/* Checkbox or thumbnail */}
      <div className="shrink-0 relative" style={{ width: 38, height: 38 }}>
        {(selectionMode || rowHovered) && (
          <div
            className={`absolute inset-0 z-10 rounded flex items-center justify-center border-2 transition-all ${
              isSelected ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-black/50 border-white/40"
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
        <img
          src={thumbSrc}
          alt={photo.name}
          className="w-full h-full object-cover rounded"
          loading="lazy"
        />
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-[#c8bfa8] text-sm truncate font-medium leading-tight">{photo.name}</p>
        <p className="text-[#3a3628] text-[11px] font-mono truncate leading-tight mt-0.5">
          {photo.folder.split(/[/\\]/).slice(-2).join("/")}
        </p>
      </div>

      {/* Date */}
      <div className="w-28 shrink-0 hidden md:block">
        <p className="text-[#5a5244] text-xs font-mono">{formatDate(dateTaken)}</p>
      </div>

      {/* Format + dimensions */}
      <div className="w-20 shrink-0 hidden lg:flex flex-col items-start gap-0.5">
        <span className="bg-[#1f1d18] text-[#7a7060] text-[9px] font-mono uppercase px-1.5 py-0.5 rounded tracking-wider">
          {photo.format}
        </span>
        {photo.width && photo.height && (
          <span className="text-[#3a3628] text-[10px] font-mono">{photo.width}×{photo.height}</span>
        )}
      </div>

      {/* Size */}
      <div className="w-16 shrink-0 hidden xl:block">
        <p className="text-[#5a5244] text-xs font-mono text-right">{formatBytes(photo.file_size)}</p>
      </div>

      {/* Camera */}
      <div className="w-32 shrink-0 hidden xl:block">
        <p className="text-[#3a3628] text-[11px] font-mono truncate">{photo.camera || "—"}</p>
      </div>

      {/* Stars */}
      <div className="shrink-0 flex gap-0.5" onClick={(e) => e.stopPropagation()}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => { const r = star === iRating ? 0 : star; setRatingOverride(photo.path, r); setRating({ path: photo.path, rating: r }); }}
            className="transition-colors text-[#3a3628] hover:text-[var(--accent)]"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill={star <= iRating ? "var(--accent)" : "none"}
              stroke={star <= iRating ? "var(--accent)" : "currentColor"}
              strokeWidth="1.5"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        ))}
      </div>

      {/* Favorite button */}
      <button
        className={`shrink-0 cursor-pointer transition-opacity ${isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-60"}`}
        onClick={(e) => { e.stopPropagation(); setFavoriteOverride(photo.path, !isFavorite); toggleFavorite({ path: photo.path }); }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill={isFavorite ? "var(--accent)" : "none"}
          stroke={isFavorite ? "var(--accent)" : "#5a5244"}
          strokeWidth="2"
        >
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </button>
    </div>
  );
});

function PhotoListView({
  photos,
  total,
  onLoadMore,
  loading,
  emptyMessage,
  onShiftSelect,
}: Omit<Props, "cardSize" | "layout"> & { onShiftSelect?: (path: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_H,
    overscan: 10,
  });

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollTop(scrollTop > 300);
    if (scrollHeight - scrollTop - clientHeight < LIST_ROW_H * 8 && photos.length < total) {
      onLoadMore?.();
    }
  }

  if (total === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center mt-32 gap-3">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 15l5-5 4 4 2-2 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <p className="text-[#3a3628] text-sm">{emptyMessage ?? "No photos here"}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Header row */}
      <div className="flex items-center gap-4 px-10 py-2 border-b border-white/5 shrink-0">
        <div className="w-[38px] shrink-0" />
        <div className="flex-1 text-[10px] font-mono text-[#3a3628] tracking-wider uppercase">Name</div>
        <div className="w-28 shrink-0 hidden md:block text-[10px] font-mono text-[#3a3628] tracking-wider uppercase">Date</div>
        <div className="w-20 shrink-0 hidden lg:block text-[10px] font-mono text-[#3a3628] tracking-wider uppercase">Format</div>
        <div className="w-16 shrink-0 hidden xl:block text-[10px] font-mono text-[#3a3628] tracking-wider uppercase text-right">Size</div>
        <div className="w-32 shrink-0 hidden xl:block text-[10px] font-mono text-[#3a3628] tracking-wider uppercase">Camera</div>
        <div className="shrink-0 text-[10px] font-mono text-[#3a3628] tracking-wider uppercase">Rating</div>
        <div className="w-[14px] shrink-0" />
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const photo = photos[vRow.index];
            return (
              <div
                key={vRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                {photo ? (
                  <PhotoListRow photo={photo} index={vRow.index} allPhotos={photos} onShiftSelect={onShiftSelect} />
                ) : (
                  <div className="h-[52px] px-10 flex items-center gap-4">
                    <div className="w-[38px] h-[38px] rounded bg-[#1a1814] animate-pulse shrink-0" />
                    <div className="flex-1 h-4 rounded bg-[#1a1814] animate-pulse" />
                    <div className="w-28 h-3 rounded bg-[#1a1814] animate-pulse hidden md:block shrink-0" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-6 right-6 p-2.5 rounded-full bg-[#1a1814] border border-white/10 text-[#5a5244] hover:text-[var(--accent)] hover:border-[var(--accent-a20)] shadow-lg transition-colors"
            title="Scroll to top"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const MASONRY_COL_WIDTH = 220;
const MASONRY_GAP = 10;

function PhotoMasonryView({
  photos, total, onLoadMore, loading, emptyMessage,
}: Omit<Props, "cardSize" | "layout">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { openLightbox, favoriteOverrides } = usePhotoStore();
  const { mutate: toggleFavorite } = useTogglePhotoFavorite();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    obs.observe(el);
    setContainerWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // Compute column count and photo positions
  const { positions, totalHeight, cols } = useMemo(() => {
    if (!containerWidth) return { positions: [], totalHeight: 0, cols: 1 };
    const numCols = Math.max(2, Math.floor((containerWidth + MASONRY_GAP) / (MASONRY_COL_WIDTH + MASONRY_GAP)));
    const colWidth = (containerWidth - (numCols - 1) * MASONRY_GAP) / numCols;
    const colHeights = new Array(numCols).fill(0) as number[];
    const pos: { x: number; y: number; w: number; h: number }[] = [];

    for (const p of photos) {
      const aspect = p.width && p.height ? p.width / p.height : 1;
      const itemH = Math.round(colWidth / aspect);
      // O(numCols) min without spread — avoids O(n) stack allocation per iteration
      let shortestCol = 0;
      for (let c = 1; c < numCols; c++) {
        if (colHeights[c] < colHeights[shortestCol]) shortestCol = c;
      }
      pos.push({
        x: shortestCol * (colWidth + MASONRY_GAP),
        y: colHeights[shortestCol],
        w: colWidth,
        h: itemH,
      });
      colHeights[shortestCol] += itemH + MASONRY_GAP;
    }

    let maxH = 0;
    for (const h of colHeights) if (h > maxH) maxH = h;
    return { positions: pos, totalHeight: maxH, cols: numCols };
  }, [photos, containerWidth]);

  const [masonryScrollTop, setMasonryScrollTop] = useState(0);
  const [masonryClientH, setMasonryClientH] = useState(0);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setMasonryScrollTop(scrollTop);
    setMasonryClientH(clientHeight);
    setShowScrollTop(scrollTop > 400);
    if (scrollHeight - scrollTop - clientHeight < 600 && photos.length < total) {
      onLoadMore?.();
    }
  }

  // Visible index range with overscan so thumbnails are ready before scroll reaches them
  const MASONRY_OVERSCAN = 600;
  const visibleTop = masonryScrollTop - MASONRY_OVERSCAN;
  const visibleBottom = masonryScrollTop + masonryClientH + MASONRY_OVERSCAN;

  if (total === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center mt-32 gap-3">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 15l5-5 4 4 2-2 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <p className="text-[#3a3628] text-sm">{emptyMessage ?? "No photos here"}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col relative">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-10 py-4"
        onScroll={handleScroll}
      >
        <div style={{ position: "relative", height: totalHeight }}>
          {photos.map((photo, i) => {
            const pos = positions[i];
            if (!pos) return null;
            // Skip rendering items outside the visible viewport + overscan
            if (pos.y + pos.h < visibleTop || pos.y > visibleBottom) {
              // Render a lightweight placeholder to preserve layout without DOM cost
              return (
                <div
                  key={photo.path}
                  style={{ position: "absolute", left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
                />
              );
            }
            return (
              <div
                key={photo.path}
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: pos.w,
                  height: pos.h,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
                className="group cursor-pointer bg-[#1a1814]"
                onClick={() => openLightbox(photos, i)}
              >
                <MasonryThumb photo={photo} width={pos.w} height={pos.h} />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-white text-[11px] font-medium truncate">{photo.name}</p>
                  {photo.rating > 0 && (
                    <div className="flex gap-px mt-0.5">
                      {Array.from({ length: photo.rating }).map((_, j) => (
                        <svg key={j} width="8" height="8" viewBox="0 0 24 24" fill="var(--accent)">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      ))}
                    </div>
                  )}
                </div>
                {(favoriteOverrides[photo.path] ?? photo.is_favorite) && (
                  <div className="absolute top-2 right-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1">
                      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                    </svg>
                  </div>
                )}
                {photo.gps_lat != null && (
                  <div className="absolute bottom-2 right-2 opacity-50">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                  </div>
                )}
              </div>
            );
          })}

          {/* Skeleton placeholders for unloaded photos */}
          {photos.length < total && Array.from({ length: Math.min(total - photos.length, cols * 2) }).map((_, i) => {
            const pos = positions[photos.length + i];
            if (!pos) return null;
            return (
              <div
                key={`skel-${i}`}
                style={{ position: "absolute", left: pos.x, top: pos.y, width: pos.w, height: pos.h, borderRadius: 8 }}
                className="bg-[#1a1814] animate-pulse"
              />
            );
          })}
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-6 right-6 p-2.5 rounded-full bg-[#1a1814] border border-white/10 text-[#5a5244] hover:text-[var(--accent)] hover:border-[var(--accent-a20)] shadow-lg transition-colors"
            title="Scroll to top"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const MasonryThumb = memo(function MasonryThumb({ photo, width, height }: { photo: Photo; width: number; height: number }) {
  const [imgError, setImgError] = useState(false);
  const { data: thumbUrl } = usePhotoThumbnail(photo.path);
  const src = thumbUrl || (IS_DEMO ? photo.path : null);
  if (!src || imgError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#1a1814]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 15l5-5 4 4 2-2 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={photo.name}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      onError={() => setImgError(true)}
      loading="lazy"
      style={{ width, height }}
    />
  );
});

export function PhotoGrid({ photos, total, onLoadMore, loading, emptyMessage, cardSize = 180, layout = "grid" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const { openLightbox, selectionAnchor, selectRange } = usePhotoStore();
  const { mutate: toggleFavorite } = useTogglePhotoFavorite();

  const handleShiftSelect = useCallback((targetPath: string) => {
    if (!selectionAnchor) return;
    const anchorIdx = photos.findIndex((p) => p.path === selectionAnchor);
    const targetIdx = photos.findIndex((p) => p.path === targetPath);
    if (anchorIdx === -1 || targetIdx === -1) return;
    const [from, to] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    selectRange(photos.slice(from, to + 1).map((p) => p.path));
  }, [selectionAnchor, selectRange, photos]);

  // Mount document-level drag-select + long-press listeners once while PhotoGrid is in the DOM.
  useEffect(() => {
    document.addEventListener("pointermove", onDocumentPointerMove, { passive: false });
    document.addEventListener("pointerup", onDocumentPointerUp);
    document.addEventListener("pointercancel", onDocumentPointerUp);
    document.addEventListener("click", onDocumentClickCapture, true);
    return () => {
      document.removeEventListener("pointermove", onDocumentPointerMove);
      document.removeEventListener("pointerup", onDocumentPointerUp);
      document.removeEventListener("pointercancel", onDocumentPointerUp);
      document.removeEventListener("click", onDocumentClickCapture, true);
    };
  }, []);

  // Re-run whenever cardSize OR layout changes. When layout switches away from "grid" the
  // containerRef div is unmounted (containerRef.current = null) and the observer is cleaned up.
  // When switching back to "grid" the div is new — we must re-attach the observer AND
  // immediately measure cols; otherwise cols stays at its stale/initial value of 4 and
  // photos pile up left-aligned with empty space on the right.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setCols(Math.max(2, Math.floor((w + GAP) / (cardSize + GAP))));
    };
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    measure(); // set immediately on mount/re-mount
    return () => obs.disconnect();
  }, [cardSize, layout]);

  const rows = Math.ceil(total / cols);
  const loadedRows = Math.ceil(photos.length / cols);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cardSize + GAP,
    overscan: 3,
  });

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollTop(scrollTop > 400);
    if (scrollHeight - scrollTop - clientHeight < cardSize * 2 && photos.length < total) {
      onLoadMore?.();
    }
  }

  function getPhoto(rowIndex: number, colIndex: number): Photo | null {
    return photos[rowIndex * cols + colIndex] ?? null;
  }

  function handleGridKey(e: React.KeyboardEvent) {
    if (photos.length === 0) return;
    const cur = focusedIdx ?? -1;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min(cur + 1, photos.length - 1);
      setFocusedIdx(next);
      scrollRef.current?.scrollTo({ top: Math.floor(next / cols) * (cardSize + GAP), behavior: "smooth" });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = Math.max(cur - 1, 0);
      setFocusedIdx(next);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(cur + cols, photos.length - 1);
      setFocusedIdx(next);
      scrollRef.current?.scrollTo({ top: Math.floor(next / cols) * (cardSize + GAP), behavior: "smooth" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(cur - cols, 0);
      setFocusedIdx(next);
      scrollRef.current?.scrollTo({ top: Math.floor(next / cols) * (cardSize + GAP), behavior: "smooth" });
    } else if (e.key === "Enter" && focusedIdx !== null && photos[focusedIdx]) {
      e.preventDefault();
      openLightbox(photos, focusedIdx);
    }
  }

  if (layout === "list") {
    return (
      <PhotoListView
        photos={photos}
        total={total}
        onLoadMore={onLoadMore}
        loading={loading}
        emptyMessage={emptyMessage}
        onShiftSelect={handleShiftSelect}
      />
    );
  }

  if (layout === "masonry") {
    return (
      <PhotoMasonryView
        photos={photos}
        total={total}
        onLoadMore={onLoadMore}
        loading={loading}
        emptyMessage={emptyMessage}
      />
    );
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col relative">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-10 py-4 outline-none"
        onScroll={handleScroll}
        tabIndex={0}
        onKeyDown={handleGridKey}
        onBlur={() => setFocusedIdx(null)}
      >
        {total === 0 && !loading && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 15l5-5 4 4 2-2 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <p className="text-[#3a3628] text-sm">{emptyMessage ?? "No photos here"}</p>
          </div>
        )}

        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => (
            <div
              key={vRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vRow.start}px)`,
                display: "flex",
                gap: GAP,
                paddingBottom: GAP,
              }}
            >
              {Array.from({ length: cols }).map((_, colIdx) => {
                const photo = getPhoto(vRow.index, colIdx);
                const globalIdx = vRow.index * cols + colIdx;
                if (globalIdx >= total) return null;
                if (!photo) {
                  return <SkeletonCard key={colIdx} size={cardSize} />;
                }
                const isFocused = focusedIdx === globalIdx;
                return (
                  <div
                    key={photo.path}
                    data-photo-path={photo.path}
                    style={isFocused ? { outline: "2px solid var(--accent)", outlineOffset: 3, borderRadius: 8 } : undefined}
                    onClick={() => setFocusedIdx(globalIdx)}
                    onPointerDown={(e) => onCardPointerDown(e.nativeEvent, photo.path)}
                  >
                    <PhotoCard
                      photo={photo}
                      size={cardSize}
                      onClick={() => openLightbox(photos, globalIdx)}
                      onFavoriteToggle={(e) => {
                        e.stopPropagation();
                        toggleFavorite({ path: photo.path });
                      }}
                      onShiftSelect={handleShiftSelect}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Scroll to top button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-6 right-6 p-2.5 rounded-full bg-[#1a1814] border border-white/10 text-[#5a5244] hover:text-[var(--accent)] hover:border-[var(--accent-a20)] shadow-lg transition-colors"
            title="Scroll to top"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
