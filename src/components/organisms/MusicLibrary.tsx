import { useState, useRef, useEffect, useCallback, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { useTracksCount, PAGE_SIZE } from "../../hooks/useLibrary";
import { usePlayerStore } from "../../store/playerStore";
import { TrackRow, TrackRowHeader, trackRowColumns } from "../molecules/TrackRow";
import { Track } from "../../types/track";
import { invoke } from "@tauri-apps/api/core";
import { AlbumGrid } from "./AlbumGrid";
import { ArtistGrid } from "./ArtistGrid";
import { GenreList } from "./GenreList";
import { PlaylistList } from "./PlaylistList";
import { PlaylistView } from "./PlaylistView";
import { useNavigationStore, registerMusicViewSetter, syncMusicView } from "../../store/navigationStore";
import { Tooltip } from "../atoms/Tooltip";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);
const MAX_PAGES_IN_MEMORY = 6;
const MAX_CONCURRENT_LOADS = 2;

type View = "tracks" | "albums" | "artists" | "genres" | "playlists";
type TrackSortBy = "title" | "artist" | "duration_asc" | "duration_desc";

const TRACK_SORT_OPTIONS: { id: TrackSortBy; label: string }[] = [
  { id: "title",        label: "Title" },
  { id: "artist",       label: "Artist" },
  { id: "duration_asc", label: "Short first" },
  { id: "duration_desc",label: "Long first" },
];

const SKELETON_COLS = trackRowColumns({ showArtistColumn: true, showAlbumColumn: true });

function SkeletonRow({ opacity }: { opacity: number }) {
  return (
    <div
      className="grid h-12 items-center gap-3 px-4 rounded-lg"
      style={{ opacity, gridTemplateColumns: SKELETON_COLS }}
    >
      <div className="w-9 h-9 rounded-md bg-[#1f1d18] animate-pulse shrink-0" />
      <div className="flex flex-col gap-1.5">
        <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-3/4" />
        <div className="h-2.5 rounded bg-[#1a1814] animate-pulse w-1/2" />
      </div>
      <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-2/3" />
      <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-3/4" />
      <div className="flex justify-end">
        <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-8" />
      </div>
    </div>
  );
}

export function MusicLibrary({ showPlayer }: { showPlayer?: boolean } = {}) {
  const [view, setView] = useState<View>("tracks");
  const [resetKeys, setResetKeys] = useState({ albums: 0, artists: 0, genres: 0 });
  const [activePlaylistId, setActivePlaylistId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [trackSortBy, setTrackSortBy] = useState<TrackSortBy>("title");
  const pagesRef = useRef<Map<number, Track[]>>(new Map());
  const pageOrderRef = useRef<number[]>([]);
  const loadingRef = useRef<Set<number>>(new Set());
  const activeLoadsRef = useRef(0);
  const isScrollingRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(0);
  const [, startTransition] = useTransition();
  const forceUpdate = useCallback(() => startTransition(() => setTick((t) => t + 1)), [startTransition]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const queryClient = useQueryClient();
  const pendingArtistName = useNavigationStore((s) => s.pendingArtistName);
  const pendingAlbumTarget = useNavigationStore((s) => s.pendingAlbumTarget);

  // Register setter so goBack() can drive MusicLibrary without prop drilling
  useEffect(() => { registerMusicViewSetter((v) => setView(v as View)); }, []);
  // Keep module-level mirror in sync
  useEffect(() => { syncMusicView(view); }, [view]);

  useEffect(() => {
    if (pendingArtistName) setView("artists");
  }, [pendingArtistName]);

  useEffect(() => {
    if (pendingAlbumTarget) setView("albums");
  }, [pendingAlbumTarget]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== debouncedSearch) {
        setDebouncedSearch(search);
        pagesRef.current.clear();
        pageOrderRef.current = [];
        loadingRef.current.clear();
        activeLoadsRef.current = 0;
        forceUpdate();
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Clear page cache when sort order changes
  useEffect(() => {
    pagesRef.current.clear();
    pageOrderRef.current = [];
    loadingRef.current.clear();
    activeLoadsRef.current = 0;
    forceUpdate();
  }, [trackSortBy]);

  useEffect(() => {
    function onFocusSearch() {
      if (view !== "tracks") return;
      searchInputRef.current?.focus();
    }
    window.addEventListener("focus-search-bar", onFocusSearch);
    return () => window.removeEventListener("focus-search-bar", onFocusSearch);
  }, [view]);

  // When a track's metadata is saved, clear pagesRef so loadPage re-fetches fresh data.
  // invalidateQueries alone doesn't help because pagesRef is a plain ref, not reactive state.
  useEffect(() => {
    const handler = () => {
      pagesRef.current.clear();
      pageOrderRef.current = [];
      loadingRef.current.clear();
      activeLoadsRef.current = 0;
      forceUpdate();
    };
    window.addEventListener("library:track-updated", handler);
    return () => window.removeEventListener("library:track-updated", handler);
  }, [forceUpdate]);

  const { data: totalCount = 0 } = useTracksCount(debouncedSearch);

  const evictOldPages = useCallback((keepPages: number[]) => {
    if (pagesRef.current.size <= MAX_PAGES_IN_MEMORY) return;
    const toEvict = pageOrderRef.current
      .filter((p) => !keepPages.includes(p))
      .slice(0, pagesRef.current.size - MAX_PAGES_IN_MEMORY);
    toEvict.forEach((p) => {
      pagesRef.current.delete(p);
      pageOrderRef.current = pageOrderRef.current.filter((x) => x !== p);
    });
  }, []);

  const loadPage = useCallback(
    async (pageIndex: number, visiblePages: number[]) => {
      if (pagesRef.current.has(pageIndex)) return;
      if (loadingRef.current.has(pageIndex)) return;
      if (activeLoadsRef.current >= MAX_CONCURRENT_LOADS) return;
      loadingRef.current.add(pageIndex);
      activeLoadsRef.current++;
      const offset = pageIndex * PAGE_SIZE;
      try {
        const tracks = await queryClient.fetchQuery({
          queryKey: ["tracks-page", debouncedSearch, offset, trackSortBy],
          queryFn: () =>
            invoke<Track[]>("get_tracks_page", {
              query: debouncedSearch,
              limit: PAGE_SIZE,
              offset,
              sortBy: trackSortBy,
            }),
          staleTime: 1000 * 60 * 5,
        });
        pagesRef.current.set(pageIndex, tracks);
        pageOrderRef.current = pageOrderRef.current.filter((p) => p !== pageIndex);
        pageOrderRef.current.push(pageIndex);
        evictOldPages(visiblePages);
        forceUpdate();
      } catch (e) {
        console.error("Failed to load page", pageIndex, e);
      } finally {
        loadingRef.current.delete(pageIndex);
        activeLoadsRef.current--;
      }
    },
    [debouncedSearch, trackSortBy, queryClient, forceUpdate, evictOldPages]
  );

  function getTrack(index: number): Track | null {
    const pageIndex = Math.floor(index / PAGE_SIZE);
    const pageOffset = index % PAGE_SIZE;
    return pagesRef.current.get(pageIndex)?.[pageOffset] ?? null;
  }

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 20,
  });

  const loadVisiblePages = useCallback(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length === 0 || totalCount === 0) return;
    const firstVisible = items[0].index;
    const lastVisible = items[items.length - 1].index;
    const firstPage = Math.floor(Math.max(0, firstVisible) / PAGE_SIZE);
    const lastPage = Math.floor(Math.min(lastVisible, totalCount - 1) / PAGE_SIZE);
    const visiblePages: number[] = [];
    for (let p = firstPage; p <= lastPage + 1; p++) {
      visiblePages.push(p);
    }
    visiblePages.forEach((p) => loadPage(p, visiblePages));
  }, [virtualizer, totalCount, loadPage]);

  useEffect(() => {
    if (totalCount > 0) loadPage(0, [0]);
  }, [totalCount, debouncedSearch]);

  useEffect(() => {
    loadVisiblePages();
  }, [tick]);

  function handlePlay(index: number) {
    const track = getTrack(index);
    if (!track) return;
    const allLoaded: Track[] = [];
    Array.from(pagesRef.current.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([, tracks]) => allLoaded.push(...tracks));
    setQueue(allLoaded, allLoaded.indexOf(track));
    setIsPlaying(true);
  }

  function handleScroll() {
    isScrollingRef.current = true;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 150);
    loadVisiblePages();
  }

  const views: View[] = ["tracks", "albums", "artists", "genres", "playlists"];

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
      <div className="px-10 pt-9 pb-0 bg-[#0e0d0b] z-10 shrink-0">
        <div className="mb-7">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1.5">
            Your Collection
          </p>
          <h1
            className="text-[42px] leading-none tracking-[-1.5px] text-[#faf8f2] font-light"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            Music{" "}
            <em className="italic text-[#c8bfa8] font-light">library</em>
          </h1>
        </div>

        {/* View tabs */}
        <div className="flex gap-1 mb-6">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => {
                setView(v);
                useNavigationStore.getState().clearBackTarget();
                if (v !== "playlists") setActivePlaylistId(null);
                if (v === "albums") setResetKeys((k) => ({ ...k, albums: k.albums + 1 }));
                else if (v === "artists") setResetKeys((k) => ({ ...k, artists: k.artists + 1 }));
                else if (v === "genres") setResetKeys((k) => ({ ...k, genres: k.genres + 1 }));
              }}
              className={`relative px-4 py-1.5 rounded-full text-xs font-mono tracking-widest uppercase transition-colors ${
                view === v ? "text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"
              }`}
            >
              {view === v && (
                <motion.span
                  layoutId="music-tab-indicator"
                  className="absolute inset-0 rounded-full bg-[var(--accent-a10)]"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10">{v}</span>
            </button>
          ))}
        </div>

        {view === "tracks" && !activePlaylistId && (
          <>
            <div className="flex gap-3 mb-4">
              <Tooltip shortcut="Ctrl+F">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search tracks, artists, albums..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
                />
              </Tooltip>
            </div>
            <div className="flex gap-1 mb-4 flex-wrap">
              {TRACK_SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setTrackSortBy(opt.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                    trackSortBy === opt.id
                      ? "bg-[var(--accent-a10)] text-[var(--accent)]"
                      : "text-[#3a3628] hover:text-[#7a7060]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <TrackRowHeader showArtistColumn showAlbumColumn />
          </>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 relative overflow-hidden">

        {/* Tracks: always mounted so the virtualizer keeps its scroll element reference */}
        <motion.div
          animate={{ opacity: view === "tracks" ? 1 : 0, y: view === "tracks" ? 0 : 8 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 flex flex-col"
          style={{ pointerEvents: view === "tracks" ? "auto" : "none" }}
        >
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-10 py-4"
            onScroll={handleScroll}
          >
            {totalCount === 0 && (
              <div className="flex flex-col items-center justify-center mt-32 gap-3">
                <p className="text-[#3a3628] text-sm">Your library is empty</p>
                <p className="text-[#3a3628] text-xs">
                  Go to Settings → Library to add a music folder
                </p>
              </div>
            )}
            {totalCount > 0 && (
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualItem: VirtualItem) => {
                  const index = virtualItem.index;
                  const track = getTrack(index);
                  const isSkeleton = !track;
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
                        <SkeletonRow opacity={1} />
                      ) : (
                        <TrackRow
                          track={track}
                          isActive={currentTrack?.path === track.path}
                          onClick={() => handlePlay(index)}
                          showArtistColumn
                          showAlbumColumn
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* Albums / Artists / Genres: AnimatePresence for sequential transitions */}
        <AnimatePresence mode="wait">
          {view !== "tracks" && (
            <motion.div
              key={
                view === "albums" ? `albums-${resetKeys.albums}`
                : view === "artists" ? `artists-${resetKeys.artists}`
                : view === "playlists" ? `playlists-${activePlaylistId ?? "list"}`
                : `genres-${resetKeys.genres}`
              }
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 overflow-hidden"
            >
              {view === "albums" && <AlbumGrid active />}
              {view === "artists" && <ArtistGrid active />}
              {view === "genres" && <GenreList active />}
              {view === "playlists" && activePlaylistId === null && (
                <PlaylistList onOpen={(id) => setActivePlaylistId(id)} />
              )}
              {view === "playlists" && activePlaylistId !== null && (
                <PlaylistView
                  playlistId={activePlaylistId}
                  onBack={() => setActivePlaylistId(null)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}