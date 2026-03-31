import { useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { useTracksCount, useScanFolder, PAGE_SIZE } from "../../hooks/useLibrary";
import { usePlayerStore } from "../../store/playerStore";
import { Button } from "../atoms/Button";
import { TrackRow } from "../molecules/TrackRow";
import { Track } from "../../types/track";
import { invoke } from "@tauri-apps/api/core";
import { AlbumGrid } from "./AlbumGrid";

const SKELETON_EXTRA = 20;
const MAX_PAGES_IN_MEMORY = 6;
const MAX_CONCURRENT_LOADS = 2;

function SkeletonRow({ opacity }: { opacity: number }) {
  return (
    <div
      className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 px-4 py-3 rounded-lg"
      style={{ opacity }}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#1f1d18] animate-pulse shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-3/4" />
          <div className="h-2.5 rounded bg-[#1a1814] animate-pulse w-1/2" />
        </div>
      </div>
      <div className="flex items-center">
        <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-2/3" />
      </div>
      <div className="flex items-center">
        <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-3/4" />
      </div>
      <div className="flex items-center justify-end">
        <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-8" />
      </div>
    </div>
  );
}

export function MusicLibrary() {
  const [view, setView] = useState<"tracks" | "albums">("tracks");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const pagesRef = useRef<Map<number, Track[]>>(new Map());
  const pageOrderRef = useRef<number[]>([]);
  const loadingRef = useRef<Set<number>>(new Set());
  const activeLoadsRef = useRef(0);
  const isScrollingRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { mutate: scanFolder, isPending } = useScanFolder();
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const queryClient = useQueryClient();

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
          queryKey: ["tracks-page", debouncedSearch, offset],
          queryFn: () =>
            invoke<Track[]>("get_tracks_page", {
              query: debouncedSearch,
              limit: PAGE_SIZE,
              offset,
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
    [debouncedSearch, queryClient, forceUpdate, evictOldPages]
  );

  function getTrack(index: number): Track | null {
    const pageIndex = Math.floor(index / PAGE_SIZE);
    const pageOffset = index % PAGE_SIZE;
    return pagesRef.current.get(pageIndex)?.[pageOffset] ?? null;
  }

  const virtualizer = useVirtualizer({
    count: totalCount + SKELETON_EXTRA,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
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

  async function handleScan() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select music folder",
      });
      if (selected && typeof selected === "string") {
        scanFolder(selected);
      }
    } catch (e) {
      console.error("Dialog error:", e);
    }
  }

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

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header — always visible */}
      <div className="px-10 pt-9 pb-0 bg-[#0e0d0b] z-10 shrink-0">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1.5">
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
          <Button variant="primary" onClick={handleScan} disabled={isPending}>
            {isPending ? "Scanning..." : "Add folder"}
          </Button>
        </div>

        {/* View tabs */}
        <div className="flex gap-1 mb-6">
          {(["tracks", "albums"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-full text-xs font-mono tracking-widest uppercase transition-colors ${view === v
                ? "bg-[#d4872a]/15 text-[#d4872a]"
                : "text-[#3a3628] hover:text-[#7a7060]"
                }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Search + column headers — only in tracks view */}
        {view === "tracks" && (
          <>
            <input
              type="text"
              placeholder="Search tracks, artists, albums..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 mb-6 transition-colors"
            />
            <div className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628]">
              <span>Title</span>
              <span>Artist</span>
              <span>Album</span>
              <span className="text-right">Time</span>
            </div>
          </>
        )}
      </div>

      {/* Body */}
      <div className={`flex-1 overflow-hidden ${view === "albums" ? "block" : "hidden"}`}>
        <AlbumGrid active={view === "albums"} />
      </div>

      {view === "tracks" && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-10 py-4"
          onScroll={handleScroll}
        >
          {!isPending && totalCount === 0 && (
            <div className="flex flex-col items-center justify-center mt-32 gap-3">
              <p className="text-[#3a3628] text-sm">Your library is empty</p>
              <p className="text-[#3a3628] text-xs">
                Click "Add folder" to scan your music
              </p>
            </div>
          )}

          {totalCount > 0 && (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualItem: VirtualItem) => {
                const index = virtualItem.index;
                const track = getTrack(index);
                const isSkeleton = index >= totalCount || !track;
                const skeletonOpacity =
                  index >= totalCount
                    ? Math.max(0, 1 - (index - totalCount) * 0.08)
                    : 1;

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
                      <SkeletonRow opacity={skeletonOpacity} />
                    ) : (
                      <TrackRow
                        track={track}
                        index={index}
                        isActive={currentTrack?.path === track.path}
                        isScrolling={isScrollingRef.current}
                        onClick={() => handlePlay(index)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}