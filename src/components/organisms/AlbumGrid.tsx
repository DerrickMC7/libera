import { useState, useEffect, useDeferredValue, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAlbums } from "../../hooks/useAlbums";
import { AlbumCard } from "../molecules/AlbumCard";
import { AlbumView } from "./AlbumView";
import { Album } from "../../types/album";

const CARD_MIN_WIDTH = 160;
const GAP = 24;

interface AlbumGridProps {
  active?: boolean;
}

function SkeletonCard({ opacity }: { opacity: number }) {
  return (
    <div className="flex flex-col gap-2.5" style={{ opacity }}>
      <div className="w-full aspect-square rounded-lg bg-[#1f1d18] animate-pulse" />
      <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-3/4" />
      <div className="h-2.5 rounded bg-[#1a1814] animate-pulse w-1/2" />
    </div>
  );
}

function calcColumns(width: number) {
  return Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP)));
}

function calcCardWidth(width: number, cols: number) {
  return Math.floor((width - (cols - 1) * GAP) / cols);
}

export function AlbumGrid({ active = true }: AlbumGridProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
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

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(deferredSearch), 300);
    return () => clearTimeout(t);
  }, [deferredSearch]);

  const { data: albums = [], isLoading } = useAlbums(debouncedSearch, active);

  // ResizeObserver — accurate once DOM is ready
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
  }, [selectedAlbum]);

  const cardHeight = cardWidth + 70;
  const rowHeight = cardHeight + GAP;
  const rows = Math.ceil(albums.length / columns);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const getAlbum = useCallback((rowIndex: number, colIndex: number): Album | null => {
    return albums[rowIndex * columns + colIndex] ?? null;
  }, [albums, columns]);

  if (selectedAlbum) {
    return (
      <AlbumView
        album={selectedAlbum}
        onBack={() => setSelectedAlbum(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
      <div className="px-10 pt-9 pb-0 bg-[#0e0d0b] z-10 shrink-0">
        <div className="mb-7">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1.5">
            Your Collection
          </p>
          <h1
            className="text-[42px] leading-none tracking-[-1.5px] text-[#faf8f2] font-light"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            Albums{" "}
            <em className="italic text-[#c8bfa8] font-light">
              {albums.length > 0 ? `· ${albums.length}` : ""}
            </em>
          </h1>
        </div>

        <input
          type="text"
          placeholder="Search albums, artists..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 mb-6 transition-colors"
        />
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

          {!isLoading && albums.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-32 gap-3">
              <p className="text-[#3a3628] text-sm">No albums found</p>
            </div>
          )}

          {albums.length > 0 && (
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
                    const album = getAlbum(virtualRow.index, colIndex);
                    if (!album) return <div key={colIndex} style={{ width: cardWidth }} />;
                    return (
                      <AlbumCard
                        key={`${album.artist}-${album.album}`}
                        album={album}
                        onClick={() => setSelectedAlbum(album)}
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