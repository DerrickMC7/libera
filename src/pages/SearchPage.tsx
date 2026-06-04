import { useState, useRef, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTracksCount, PAGE_SIZE } from "../hooks/useLibrary";
import { useBooks } from "../hooks/useBooks";
import { useGenres } from "../hooks/useGenres";
import { usePlayerStore } from "../store/playerStore";
import { TrackRow } from "../components/molecules/TrackRow";
import { BookRow } from "../components/molecules/BookRow";
import { PdfReader } from "../components/organisms/PdfReader/PdfReader";
import { EpubViewer } from "../components/organisms/EpubViewer";
import { Track } from "../types/track";
import { Book } from "../types/book";

const SKELETON_EXTRA = 5;

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  // page cache for virtualized track results
  const pagesRef = useRef<Map<number, Track[]>>(new Map());
  const loadingRef = useRef<Set<number>>(new Set());
  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);
  const scrollRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const { data: books = [] } = useBooks();
  const { data: genres = [] } = useGenres(debouncedQuery, !!debouncedQuery);
  const { data: trackCount = 0 } = useTracksCount(debouncedQuery);

  // Debounce + clear page cache on query change
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      pagesRef.current.clear();
      loadingRef.current.clear();
      forceUpdate();
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Also clear cache when debouncedQuery changes (safety net)
  const prevQueryRef = useRef("");
  if (prevQueryRef.current !== debouncedQuery) {
    prevQueryRef.current = debouncedQuery;
    pagesRef.current.clear();
    loadingRef.current.clear();
  }

  const loadPage = useCallback(
    async (pageIndex: number) => {
      if (pagesRef.current.has(pageIndex)) return;
      if (loadingRef.current.has(pageIndex)) return;
      loadingRef.current.add(pageIndex);
      try {
        const tracks = await queryClient.fetchQuery({
          queryKey: ["tracks-page", debouncedQuery, pageIndex * PAGE_SIZE, "artist"],
          queryFn: () =>
            invoke<Track[]>("get_tracks_page", {
              query: debouncedQuery,
              limit: PAGE_SIZE,
              offset: pageIndex * PAGE_SIZE,
              sortBy: "artist",
            }),
          staleTime: 1000 * 60 * 5,
        });
        pagesRef.current.set(pageIndex, tracks);
        forceUpdate();
      } finally {
        loadingRef.current.delete(pageIndex);
      }
    },
    [debouncedQuery, queryClient, forceUpdate]
  );

  function getTrack(index: number): Track | null {
    const page = Math.floor(index / PAGE_SIZE);
    const offset = index % PAGE_SIZE;
    return pagesRef.current.get(page)?.[offset] ?? null;
  }

  const virtualizer = useVirtualizer({
    count: trackCount > 0 ? trackCount + SKELETON_EXTRA : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // Load visible pages on scroll
  const loadVisiblePages = useCallback(() => {
    const items = virtualizer.getVirtualItems();
    if (!items.length || !trackCount) return;
    const firstPage = Math.floor(items[0].index / PAGE_SIZE);
    const lastPage = Math.floor(Math.min(items[items.length - 1].index, trackCount - 1) / PAGE_SIZE);
    for (let p = firstPage; p <= lastPage + 1; p++) loadPage(p);
  }, [virtualizer, trackCount, loadPage]);

  useEffect(() => { loadVisiblePages(); }, [tick]);

  // Load first page when count arrives
  useEffect(() => {
    if (trackCount > 0) loadPage(0);
  }, [trackCount, debouncedQuery]);

  const filteredBooks = debouncedQuery
    ? books.filter((b) => b.title.toLowerCase().includes(debouncedQuery.toLowerCase()))
    : [];

  const hasResults = trackCount > 0 || filteredBooks.length > 0 || genres.length > 0;

  function handlePlayTrack(index: number) {
    const all: Track[] = [];
    Array.from(pagesRef.current.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([, page]) => all.push(...page));
    const track = getTrack(index);
    if (!track) return;
    const globalIdx = all.indexOf(track);
    setQueue(all.length ? all : [track], globalIdx >= 0 ? globalIdx : 0);
    setIsPlaying(true);
  }

  // Book viewer
  if (selectedBook?.format === "pdf") {
    return <PdfReader book={selectedBook} onClose={() => setSelectedBook(null)} />;
  }
  if (selectedBook?.format === "epub") {
    return <EpubViewer book={selectedBook} onClose={() => setSelectedBook(null)} />;
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
      <div className="px-10 pt-9 pb-0 sticky top-0 bg-[#0e0d0b] z-10">
        <div className="mb-7">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1.5">
            Explore
          </p>
          <h1
            className="text-[42px] leading-none tracking-[-1.5px] text-[#faf8f2] font-light mb-6"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            Search <em className="italic text-[#c8bfa8] font-light">everything</em>
          </h1>
          <input
            type="text"
            placeholder="Search music, books, genres..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-3 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)]/40 transition-colors"
          />
        </div>
      </div>

      {/* Results */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-4" onScroll={loadVisiblePages}>
        {!query && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <p className="text-[#3a3628] text-sm">Start typing to search</p>
          </div>
        )}

        {query && !hasResults && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <p className="text-[#3a3628] text-sm">No results for "{query}"</p>
          </div>
        )}

        {/* Genres section */}
        {genres.length > 0 && (
          <div className="mb-8">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#3a3628] mb-3 px-1">
              Genres — {genres.length} results
            </p>
            <div className="flex flex-wrap gap-2">
              {genres.map((genre) => (
                <div
                  key={genre.name}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1f1d18] border border-white/7"
                >
                  <span className="text-sm text-[#f0ead8]">{genre.name}</span>
                  <span className="text-xs font-mono text-[#3a3628]">{genre.track_count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tracks section — virtualized */}
        {trackCount > 0 && (
          <div className="mb-8">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#3a3628] mb-3 px-1">
              Music — {trackCount} results
            </p>
            <div className="grid grid-cols-[2fr_1fr_1fr_120px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628] mb-1">
              <span>Title</span>
              <span>Artist</span>
              <span>Album</span>
              <span className="text-right">Time</span>
            </div>
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const index = virtualItem.index;
                const track = getTrack(index);
                const isSkeleton = index >= trackCount || !track;
                return (
                  <div
                    key={virtualItem.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    {isSkeleton ? (
                      <div className="h-14 rounded-lg bg-[#1a1814] animate-pulse mx-0 mb-0.5" style={{ opacity: Math.max(0, 1 - (index - trackCount) * 0.3) }} />
                    ) : (
                      <TrackRow
                        track={track}
                        index={index}
                        isActive={currentTrack?.path === track.path}
                        onClick={() => handlePlayTrack(index)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Books section */}
        {filteredBooks.length > 0 && (
          <div>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#3a3628] mb-3 px-1">
              Books & Papers — {filteredBooks.length} results
            </p>
            <div className="grid grid-cols-[1fr_80px_80px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628] mb-1">
              <span>Title</span>
              <span>Format</span>
              <span className="text-right">Size</span>
            </div>
            {filteredBooks.map((book, index) => (
              <BookRow
                key={book.path}
                book={book}
                index={index}
                onClick={() => setSelectedBook(book)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
