import { useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import { useLibrary, useScanFolder } from "../../hooks/useLibrary";
import { usePlayerStore } from "../../store/playerStore";
import { Button } from "../atoms/Button";
import { TrackRow } from "../molecules/TrackRow";
import { Track } from "../../types/track";

const SKELETON_EXTRA = 20;

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
  const { data: tracks = [], isLoading } = useLibrary();
  const { mutate: scanFolder, isPending } = useScanFolder();
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.artist.toLowerCase().includes(search.toLowerCase()) ||
      t.album.toLowerCase().includes(search.toLowerCase())
  );

  const virtualizer = useVirtualizer({
    count: filtered.length + SKELETON_EXTRA,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 50,
  });

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

  function handlePlay(track: Track, index: number) {
    setQueue(filtered, index);
    setIsPlaying(true);
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
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

        {/* Search */}
        <input
          type="text"
          placeholder="Search tracks, artists, albums..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 mb-6 transition-colors"
        />

        {/* Column headers */}
        <div className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628]">
          <span>Title</span>
          <span>Artist</span>
          <span>Album</span>
          <span className="text-right">Time</span>
        </div>
      </div>

      {/* Track list — virtualized */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-4">

        {/* Empty state */}
        {!isLoading && !isPending && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <p className="text-[#3a3628] text-sm">Your library is empty</p>
            <p className="text-[#3a3628] text-xs">
              Click "Add folder" to scan your music
            </p>
          </div>
        )}

        {/* Virtualized track list — always rendered when tracks exist */}
        {(filtered.length > 0 || isLoading) && (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem: VirtualItem) => {
              const isSkeleton = virtualItem.index >= filtered.length;
              const track = isSkeleton ? null : filtered[virtualItem.index];
              const skeletonOpacity = isSkeleton
                ? Math.max(0, 1 - (virtualItem.index - filtered.length) * 0.1)
                : 1;

              return (
                <div
                  key={virtualItem.index}
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
                      track={track!}
                      index={virtualItem.index}
                      isActive={currentTrack?.path === track!.path}
                      onClick={() => handlePlay(track!, virtualItem.index)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}