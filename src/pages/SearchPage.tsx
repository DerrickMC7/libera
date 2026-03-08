import { useState } from "react";
import { useLibrary } from "../hooks/useLibrary";
import { useBooks } from "../hooks/useBooks";
import { usePlayerStore } from "../store/playerStore";
import { TrackRow } from "../components/molecules/TrackRow";
import { BookRow } from "../components/molecules/BookRow";
import { Track } from "../types/track";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const { data: tracks = [] } = useLibrary();
  const { data: books = [] } = useBooks();
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();

  const q = query.toLowerCase();

  const filteredTracks = query
    ? tracks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
      )
    : [];

  const filteredBooks = query
    ? books.filter((b) => b.title.toLowerCase().includes(q))
    : [];

  const hasResults = filteredTracks.length > 0 || filteredBooks.length > 0;

  function handlePlayTrack(track: Track, index: number) {
    setQueue(filteredTracks, index);
    setIsPlaying(true);
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
      <div className="px-10 pt-9 pb-0 sticky top-0 bg-[#0e0d0b] z-10">
        <div className="mb-7">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1.5">
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
            placeholder="Search music, books, papers..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-3 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 transition-colors"
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-10 py-4">
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

        {/* Tracks section */}
        {filteredTracks.length > 0 && (
          <div className="mb-8">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#3a3628] mb-3 px-4">
              Music — {filteredTracks.length} results
            </p>
            <div className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628] mb-1">
              <span>Title</span>
              <span>Artist</span>
              <span>Album</span>
              <span className="text-right">Time</span>
            </div>
            {filteredTracks.map((track, index) => (
              <TrackRow
                key={track.path}
                track={track}
                index={index}
                isActive={currentTrack?.path === track.path}
                onClick={() => handlePlayTrack(track, index)}
              />
            ))}
          </div>
        )}

        {/* Books section */}
        {filteredBooks.length > 0 && (
          <div>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#3a3628] mb-3 px-4">
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
                onClick={() => console.log("Open book:", book.path)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}