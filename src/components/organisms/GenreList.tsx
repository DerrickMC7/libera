import { useState, useEffect, useDeferredValue, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGenres } from "../../hooks/useGenres";
import { useArtwork } from "../../hooks/useArtwork";
import { usePlayerStore } from "../../store/playerStore";
import { invoke } from "@tauri-apps/api/core";
import { Track } from "../../types/track";
import { Genre } from "../../types/genre";

interface GenreListProps {
  active?: boolean;
}

function GenreRow({
  genre,
  onClick,
}: {
  genre: Genre;
  onClick: () => void;
}) {
  const { data: artworkUrl } = useArtwork(genre.cover_path);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-[#1f1d18] transition-colors text-left group"
    >
      <div className="w-11 h-11 rounded-lg overflow-hidden bg-[#1f1d18] shrink-0">
        {artworkUrl ? (
          <img src={artworkUrl} alt={genre.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#f0ead8] truncate group-hover:text-[#d4872a] transition-colors">
          {genre.name}
        </p>
        <p className="text-xs text-[#3a3628] font-mono mt-0.5">
          {genre.track_count} {genre.track_count === 1 ? "track" : "tracks"}
        </p>
      </div>

      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
    </button>
  );
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
      setTracks(t);
      setIsLoading(false);
    });
  }, [genre.name]);

  function formatDuration(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b] overflow-y-auto">
      <div className="px-10 pt-9 pb-6">
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
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1.5">Genre</p>
          <h1
            className="text-[32px] leading-none tracking-[-1px] text-[#faf8f2] font-light"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            {genre.name}
          </h1>
          <p className="text-xs text-[#3a3628] font-mono mt-2">
            {genre.track_count} tracks
          </p>
          <button
            onClick={() => { setQueue(tracks, 0); setIsPlaying(true); }}
            className="mt-4 flex items-center gap-2 bg-[#d4872a] hover:bg-[#e8a84c] text-white text-xs font-mono tracking-widest uppercase px-5 py-2.5 rounded-full transition-colors w-fit"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play all
          </button>
        </div>

        <div className="border-t border-white/6" />
      </div>

      <div className="px-10 pb-8">
        {isLoading && (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-[#1a1814] animate-pulse mb-1" style={{ opacity: 1 - i * 0.08 }} />
            ))}
          </div>
        )}

        {tracks.map((track, idx) => (
          <button
            key={track.path}
            onClick={() => { setQueue(tracks, idx); setIsPlaying(true); }}
            className={`w-full grid grid-cols-[24px_1fr_1fr_80px] gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[#1f1d18] ${
              currentTrack?.path === track.path ? "bg-[rgba(212,135,42,0.08)]" : ""
            }`}
          >
            <span className={`text-xs font-mono self-center ${currentTrack?.path === track.path ? "text-[#d4872a]" : "text-[#3a3628]"}`}>
              {idx + 1}
            </span>
            <span className={`text-sm truncate self-center ${currentTrack?.path === track.path ? "text-[#d4872a]" : "text-[#f0ead8]"}`}>
              {track.title}
            </span>
            <span className="text-sm text-[#7a7060] truncate self-center">
              {track.artist}
            </span>
            <span className="text-xs font-mono text-[#3a3628] self-center text-right">
              {formatDuration(track.duration_secs)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function GenreList({ active = true }: GenreListProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(deferredSearch), 300);
    return () => clearTimeout(t);
  }, [deferredSearch]);

  const { data: genres = [], isLoading } = useGenres(debouncedSearch, active);

  const virtualizer = useVirtualizer({
    count: genres.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 15,
  });

  if (selectedGenre) {
    return <GenreView genre={selectedGenre} onBack={() => setSelectedGenre(null)} />;
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      <div className="px-10 pt-9 pb-0 bg-[#0e0d0b] z-10 shrink-0">
        <div className="mb-7">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1.5">
            Your Collection
          </p>
          <h1
            className="text-[42px] leading-none tracking-[-1.5px] text-[#faf8f2] font-light"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            Genres{" "}
            <em className="italic text-[#c8bfa8] font-light">
              {genres.length > 0 ? `· ${genres.length}` : ""}
            </em>
          </h1>
        </div>

        <input
          type="text"
          placeholder="Search genres..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 mb-6 transition-colors"
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-4">
        {isLoading && (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3" style={{ opacity: 1 - i * 0.05 }}>
                <div className="w-11 h-11 rounded-lg bg-[#1f1d18] animate-pulse shrink-0" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-1/3" />
                  <div className="h-2.5 rounded bg-[#1a1814] animate-pulse w-1/4" />
                </div>
              </div>
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
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const genre = genres[virtualItem.index];
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
                  <GenreRow genre={genre} onClick={() => setSelectedGenre(genre)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}