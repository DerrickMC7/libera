import { useState, useEffect, useDeferredValue, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion, AnimatePresence } from "framer-motion";
import { useArtists } from "../../hooks/useArtists";
import { useArtwork } from "../../hooks/useArtwork";
import { useArtistImage } from "../../hooks/useArtistImage";
import { useArtistImageDownload } from "../../hooks/useArtistImageDownload";
import { ArtistView } from "./ArtistView";
import { Artist } from "../../types/artist";

interface ArtistListProps {
  active?: boolean;
}

function ArtistRow({ artist, onClick }: { artist: Artist; onClick: () => void }) {
  const { data: artistImageUrl } = useArtistImage(artist.name);
  const { data: albumArtUrl } = useArtwork(artist.cover_path);
  const imageUrl = artistImageUrl ?? albumArtUrl;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-[#1f1d18] transition-colors text-left group"
    >
      <div className="w-9 h-12 rounded-md overflow-hidden bg-[#1f1d18] shrink-0">
        {imageUrl ? (
          <img src={imageUrl} alt={artist.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#f0ead8] truncate group-hover:text-[var(--accent)] transition-colors">
          {artist.name}
        </p>
        <p className="text-xs text-[#3a3628] font-mono mt-0.5">
          {artist.album_count} {artist.album_count === 1 ? "album" : "albums"} · {artist.track_count} tracks
        </p>
      </div>

      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
      </svg>
    </button>
  );
}

export function ArtistList({ active = true }: ArtistListProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isDownloading, completed, total, percent, currentArtist, download } =
    useArtistImageDownload();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(deferredSearch), 300);
    return () => clearTimeout(t);
  }, [deferredSearch]);

  const { data: artists = [], isLoading } = useArtists(debouncedSearch, active);

  const virtualizer = useVirtualizer({
    count: artists.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 15,
  });

  if (selectedArtist) {
    return <ArtistView artist={selectedArtist} onBack={() => setSelectedArtist(null)} />;
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
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
              Artists{" "}
              <em className="italic text-[#c8bfa8] font-light">
                {artists.length > 0 ? `· ${artists.length}` : ""}
              </em>
            </h1>
          </div>

          <button
            onClick={download}
            disabled={isDownloading}
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono tracking-widest uppercase transition-colors
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
                <p className="text-[10px] font-mono text-[#3a3628] px-1 truncate">{currentArtist}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <input
          type="text"
          placeholder="Search artists..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] mb-4 sm:mb-6 transition-colors"
          style={{ fontSize: "16px" }}
        />

        <div className="grid grid-cols-[1fr_120px_80px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628]">
          <span>Artist</span>
          <span>Albums</span>
          <span className="text-right">Tracks</span>
        </div>
      </div>

      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-10 py-4">
        {isLoading && (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3" style={{ opacity: 1 - i * 0.05 }}>
                <div className="w-9 h-12 rounded-md bg-[#1f1d18] animate-pulse shrink-0" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-1/3" />
                  <div className="h-2.5 rounded bg-[#1a1814] animate-pulse w-1/4" />
                </div>
              </div>
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
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const artist = artists[virtualItem.index];
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
                  <ArtistRow artist={artist} onClick={() => setSelectedArtist(artist)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
