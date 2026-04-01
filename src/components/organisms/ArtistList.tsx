import { useState, useEffect, useDeferredValue, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useArtists } from "../../hooks/useArtists";
import { useArtwork } from "../../hooks/useArtwork";
import { ArtistView } from "./ArtistView";
import { Artist } from "../../types/artist";

interface ArtistListProps {
  active?: boolean;
}

function ArtistRow({ artist, onClick }: { artist: Artist; onClick: () => void }) {
  const { data: artworkUrl } = useArtwork(artist.cover_path);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-[#1f1d18] transition-colors text-left group"
    >
      {/* Avatar */}
      <div className="w-11 h-11 rounded-full overflow-hidden bg-[#1f1d18] shrink-0">
        {artworkUrl ? (
          <img src={artworkUrl} alt={artist.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#f0ead8] truncate group-hover:text-[#d4872a] transition-colors">
          {artist.name}
        </p>
        <p className="text-xs text-[#3a3628] font-mono mt-0.5">
          {artist.album_count} {artist.album_count === 1 ? "album" : "albums"} · {artist.track_count} tracks
        </p>
      </div>

      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
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
    return (
      <ArtistView
        artist={selectedArtist}
        onBack={() => setSelectedArtist(null)}
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
            Artists{" "}
            <em className="italic text-[#c8bfa8] font-light">
              {artists.length > 0 ? `· ${artists.length}` : ""}
            </em>
          </h1>
        </div>

        <input
          type="text"
          placeholder="Search artists..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 mb-6 transition-colors"
        />

        <div className="grid grid-cols-[1fr_120px_80px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628]">
          <span>Artist</span>
          <span>Albums</span>
          <span className="text-right">Tracks</span>
        </div>
      </div>

      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-4">
        {isLoading && (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3" style={{ opacity: 1 - i * 0.05 }}>
                <div className="w-11 h-11 rounded-full bg-[#1f1d18] animate-pulse shrink-0" />
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
                  <ArtistRow
                    artist={artist}
                    onClick={() => setSelectedArtist(artist)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}