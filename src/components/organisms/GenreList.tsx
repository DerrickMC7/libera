import { useState, useEffect, useDeferredValue, useRef, useCallback } from "react";
import { Tooltip } from "../atoms/Tooltip";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGenres, GenreSortBy } from "../../hooks/useGenres";
import { usePlayerStore } from "../../store/playerStore";
import { useNavigationStore, syncGenreName } from "../../store/navigationStore";
import { GenreCard } from "../molecules/GenreCard";
import { GenreMap } from "./GenreMap";
import { registerGenreMapSetter } from "../../lib/automationBus";
import { TrackRow, TrackRowHeader } from "../molecules/TrackRow";
import { invoke } from "@tauri-apps/api/core";
import { Track } from "../../types/track";
import { Genre } from "../../types/genre";

const CARD_MIN_WIDTH = 260; // landscape tiles need more room; gives ~3 cols at 1080px
const GAP = 24;

interface GenreListProps {
  active?: boolean;
  onDetailChange?: (isDetail: boolean) => void;
}

function SkeletonCard({ opacity }: { opacity: number }) {
  return (
    <div style={{ opacity }}>
      <div className="w-full aspect-[3/2] rounded-xl bg-[#1f1d18] animate-pulse" />
    </div>
  );
}

function calcColumns(width: number) {
  return Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP)));
}

function calcCardWidth(width: number, cols: number) {
  return Math.floor((width - (cols - 1) * GAP) / cols);
}

function GenreView({ genre, onBack }: { genre: Genre; onBack: () => void }) {
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    invoke<Track[]>("get_genre_tracks", {
      genre: genre.name,
      limit: 500,
      offset: 0,
    }).then((t) => {
      setTracks(t ?? []);
      setIsLoading(false);
    });
  }, [genre.name]);

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b] overflow-y-auto">
      <div className="px-4 sm:px-10 pt-4 sm:pt-9 pb-4 sm:pb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors mb-8 text-xs font-mono"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          Genres
        </button>

        <div className="mb-6">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1.5">Genre</p>
          <h1
            className="text-[24px] sm:text-[32px] leading-none tracking-[-1px] text-[#faf8f2] font-light"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            {genre.name}
          </h1>
          <p className="text-xs text-[#3a3628] font-mono mt-2">
            {genre.track_count} tracks
          </p>
          <button
            onClick={() => { setQueue(tracks, 0); setIsPlaying(true); }}
            className="mt-4 flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono tracking-widest uppercase px-5 py-2.5 rounded-full transition-colors w-fit"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play all
          </button>
        </div>

        <div className="border-t border-white/6" />
      </div>

      <div className="px-4 sm:px-10 pb-8">
        {isLoading && (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-[#1a1814] animate-pulse mb-1" style={{ opacity: 1 - i * 0.08 }} />
            ))}
          </div>
        )}

        {tracks.length > 0 && (
          <TrackRowHeader showArtistColumn showAlbumColumn />
        )}

        {tracks.map((track, idx) => (
          <TrackRow
            key={track.path}
            track={track}
            isActive={currentTrack?.path === track.path}
            onClick={() => { setQueue(tracks, idx); setIsPlaying(true); }}
            showArtistColumn
            showAlbumColumn
          />
        ))}
      </div>
    </div>
  );
}

export function GenreList({ active = true, onDetailChange }: GenreListProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<GenreSortBy>("name");
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [showMap, setShowMap] = useState(false);
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
  const { pendingGenreName, clearPendingGenre } = useNavigationStore();

  useEffect(() => {
    function onFocusSearch() { searchInputRef.current?.focus(); }
    window.addEventListener("focus-search-bar", onFocusSearch);
    return () => window.removeEventListener("focus-search-bar", onFocusSearch);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(deferredSearch), 300);
    return () => clearTimeout(t);
  }, [deferredSearch]);

  const { data: genres = [], isLoading } = useGenres(debouncedSearch, active, sortBy);

  // Keep module-level mirror in sync so backTarget can snapshot the open genre
  useEffect(() => { syncGenreName(selectedGenre?.name ?? null); }, [selectedGenre]);

  // Restore the previously open genre after a back navigation
  useEffect(() => {
    if (!pendingGenreName || genres.length === 0) return;
    const genre = genres.find((g) => g.name === pendingGenreName);
    if (genre) { setSelectedGenre(genre); clearPendingGenre(); }
  }, [pendingGenreName, genres]);

  useEffect(() => { onDetailChange?.(!!selectedGenre || showMap); }, [selectedGenre, showMap]);

  // Expose the map toggle to the benchmark automation while this list is mounted.
  useEffect(() => {
    registerGenreMapSetter(setShowMap);
    return () => registerGenreMapSetter(null);
  }, []);

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
  }, [selectedGenre]);

  // 3:2 landscape tile; text overlaid inside the card (no text row below)
  const cardHeight = Math.round(cardWidth * (2 / 3));
  const rowHeight = cardHeight + GAP;
  const rows = Math.ceil(genres.length / columns);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const getGenre = useCallback((rowIndex: number, colIndex: number): Genre | null => {
    return genres[rowIndex * columns + colIndex] ?? null;
  }, [genres, columns]);

  if (showMap) {
    return <GenreMap onBack={() => setShowMap(false)} />;
  }

  if (selectedGenre) {
    return <GenreView genre={selectedGenre} onBack={() => setSelectedGenre(null)} />;
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      <div className="px-4 sm:px-10 pt-4 sm:pt-9 pb-0 bg-[#0e0d0b] z-10 shrink-0">
        <div className="flex items-end justify-between mb-4 sm:mb-7">
          <div>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1.5">
              Your Collection
            </p>
            <h1
              className="text-[28px] sm:text-[42px] leading-none tracking-[-1px] sm:tracking-[-1.5px] text-[#faf8f2] font-light"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              Genres{" "}
              <em className="italic text-[#c8bfa8] font-light">
                {genres.length > 0 ? `· ${genres.length}` : ""}
              </em>
            </h1>
          </div>

          <button
            onClick={() => setShowMap(true)}
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono tracking-widest uppercase transition-colors
              bg-[#1f1d18] text-[#7a7060] hover:text-[var(--accent)] hover:bg-[#2a2820] border border-white/5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a3 3 0 0 0-1 5.83V10H7a3 3 0 1 0 0 2h4v2.17a3 3 0 1 0 2 0V12h4a3 3 0 1 0 0-2h-4V7.83A3 3 0 0 0 12 2z" />
            </svg>
            View genre map
          </button>
        </div>

        <div className="flex gap-3 mb-4 sm:mb-6">
          <Tooltip shortcut="Ctrl+F">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search genres..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
              style={{ fontSize: "16px" }}
            />
          </Tooltip>
          {(["name", "count"] as GenreSortBy[]).map((opt) => (
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-10 py-4">
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

          {!isLoading && genres.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-32 gap-3">
              <p className="text-[#3a3628] text-sm">No genres found</p>
            </div>
          )}

          {genres.length > 0 && (
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
                    const genre = getGenre(virtualRow.index, colIndex);
                    if (!genre) return <div key={colIndex} style={{ width: cardWidth }} />;
                    return (
                      <GenreCard
                        key={genre.name}
                        genre={genre}
                        onClick={() => setSelectedGenre(genre)}
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
