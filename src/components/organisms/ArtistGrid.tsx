import { useState, useEffect, useDeferredValue, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion, AnimatePresence } from "framer-motion";
import { useArtists } from "../../hooks/useArtists";
import { useArtistImageDownload } from "../../hooks/useArtistImageDownload";
import { ArtistCard } from "../molecules/ArtistCard";
import { ArtistView } from "./ArtistView";
import { Artist } from "../../types/artist";
import { useNavigationStore } from "../../store/navigationStore";
import { Tooltip } from "../atoms/Tooltip";

const CARD_MIN_WIDTH = 280; // portrait cards need more room; gives 3 cols at 1080px, 4 on wider screens
const GAP = 24;

interface ArtistGridProps {
  active?: boolean;
  onDetailChange?: (isDetail: boolean) => void;
}

function SkeletonCard({ opacity }: { opacity: number }) {
  return (
    <div style={{ opacity }}>
      <div className="w-full aspect-[3/4] rounded-xl bg-[#1f1d18] animate-pulse" />
    </div>
  );
}

function calcColumns(width: number) {
  return Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP)));
}

function calcCardWidth(width: number, cols: number) {
  return Math.floor((width - (cols - 1) * GAP) / cols);
}

type ArtistSortBy = "name" | "count";

export function ArtistGrid({ active = true, onDetailChange }: ArtistGridProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<ArtistSortBy>("name");
  const { isDownloading, isPaused, completed, total, percent, currentArtist, download, pause, resume, cancel } =
    useArtistImageDownload();
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [columns, setColumns] = useState(() => {
    const w = window.innerWidth - 52 - 80;
    return calcColumns(w);
  });
  const [cardWidth, setCardWidth] = useState(() => {
    const w = window.innerWidth - 52 - 80;
    const cols = calcColumns(w);
    return calcCardWidth(w, cols);
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onFocusSearch() { searchInputRef.current?.focus(); }
    window.addEventListener("focus-search-bar", onFocusSearch);
    return () => window.removeEventListener("focus-search-bar", onFocusSearch);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(deferredSearch), 300);
    return () => clearTimeout(t);
  }, [deferredSearch]);

  const { data: rawArtists = [], isLoading } = useArtists(debouncedSearch, active);
  const { pendingArtistName, clearPendingArtist, backTarget, goBack } = useNavigationStore();

  useEffect(() => {
    if (!pendingArtistName || rawArtists.length === 0) return;
    const artist = rawArtists.find((a) => a.name === pendingArtistName);
    if (artist) {
      setSelectedArtist(artist);
      clearPendingArtist();
    }
  }, [pendingArtistName, rawArtists]);

  useEffect(() => { onDetailChange?.(!!selectedArtist); }, [selectedArtist]);

  const handleBack = useCallback(() => {
    if (backTarget) goBack();
    else setSelectedArtist(null);
  }, [backTarget, goBack]);
  const artists = sortBy === "count"
    ? [...rawArtists].sort((a, b) => b.track_count - a.track_count)
    : rawArtists;

  // ResizeObserver
  useEffect(() => {
    if (!gridRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (width > 0) {
        const cols = calcColumns(width);
        setColumns(cols);
        setCardWidth(calcCardWidth(width, cols));
      }
    });
    observer.observe(gridRef.current);
    return () => observer.disconnect();
  }, [selectedArtist]);

  // 3:4 portrait ratio; no text below the card (text is overlaid inside)
  const cardHeight = Math.round(cardWidth * (4 / 3));
  const rowHeight = cardHeight + GAP;
  const rows = Math.ceil(artists.length / columns);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const getArtist = useCallback((rowIndex: number, colIndex: number): Artist | null => {
    return artists[rowIndex * columns + colIndex] ?? null;
  }, [artists, columns]);

  if (selectedArtist) {
    return <ArtistView artist={selectedArtist} onBack={handleBack} />;
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
      <div className="px-10 pt-9 pb-0 bg-[#0e0d0b] z-10 shrink-0">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1.5">
              Your Collection
            </p>
            <h1
              className="text-[42px] leading-none tracking-[-1.5px] text-[#faf8f2] font-light"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              Artists{" "}
              <em className="italic text-[#c8bfa8] font-light">
                {artists.length > 0 ? `· ${artists.length}` : ""}
              </em>
            </h1>
          </div>

          <button
            onClick={download}
            disabled={isDownloading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono tracking-widest uppercase transition-colors
              bg-[#1f1d18] text-[#7a7060] hover:text-[#c8bfa8] hover:bg-[#2a2820]
              disabled:opacity-40 disabled:cursor-not-allowed border border-white/5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14l-4-4h3V9h2v4h3l-4 4z" />
            </svg>
            {isDownloading ? "Downloading…" : "Download artist images"}
          </button>
        </div>

        {/* Progress bar */}
        <AnimatePresence>
          {isDownloading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-4"
            >
              <div className="flex items-center gap-3 py-2.5 px-1">
                <div className="flex-1 h-px bg-[#1f1d18] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-hover))", width: `${percent}%` }}
                    transition={{ ease: "easeOut", duration: 0.3 }}
                  />
                </div>
                <span className="text-[11px] font-mono text-[#7a7060] shrink-0 tabular-nums">
                  {completed} / {total}
                </span>
                <span className="text-[11px] font-mono text-[var(--accent)] shrink-0 tabular-nums">
                  {percent}%
                </span>
              </div>
              {currentArtist && (
                <p className="text-[10px] font-mono text-[#3a3628] px-1 pb-1 truncate">{currentArtist}</p>
              )}
              <div className="flex gap-2 px-1 pb-2">
                <button
                  onClick={isPaused ? resume : pause}
                  className="text-[10px] font-mono px-2.5 py-1 rounded-md bg-[#1f1d18] text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
                >
                  {isPaused ? "Resume" : "Pause"}
                </button>
                <button
                  onClick={cancel}
                  className="text-[10px] font-mono px-2.5 py-1 rounded-md bg-[#1f1d18] text-[#c85858] hover:bg-[#c85858]/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-3 mb-6">
          <Tooltip shortcut="Ctrl+F">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search artists..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </Tooltip>
          {(["name", "count"] as ArtistSortBy[]).map((opt) => (
            <button
              key={opt}
              onClick={() => setSortBy(opt)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors shrink-0 ${
                sortBy === opt
                  ? "bg-[var(--accent-a10)] text-[var(--accent)]"
                  : "text-[#3a3628] hover:text-[#7a7060] bg-[#1f1d18]"
              }`}
            >
              {opt === "name" ? "Name" : "Count"}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-4">
        <div ref={gridRef} className="w-full">
          {isLoading && (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
            >
              {Array.from({ length: columns * 3 }).map((_, i) => (
                <SkeletonCard key={i} opacity={Math.max(0.1, 1 - i * 0.05)} />
              ))}
            </div>
          )}

          {!isLoading && artists.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-32 gap-3">
              <p className="text-[#3a3628] text-sm">No artists found</p>
            </div>
          )}

          {artists.length > 0 && (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${rowHeight}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`,
                    gap: `${GAP}px`,
                    alignItems: "start",
                  }}
                >
                  {Array.from({ length: columns }).map((_, colIndex) => {
                    const artist = getArtist(virtualRow.index, colIndex);
                    if (!artist) return <div key={colIndex} style={{ width: cardWidth }} />;
                    return (
                      <ArtistCard
                        key={artist.name}
                        artist={artist}
                        onClick={() => {
                          useNavigationStore.getState().clearBackTarget();
                          setSelectedArtist(artist);
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

