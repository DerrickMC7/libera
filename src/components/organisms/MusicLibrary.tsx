import { useState } from "react";
import { useLibrary, useScanFolder } from "../../hooks/useLibrary";
import { usePlayerStore } from "../../store/playerStore";
import { Button } from "../atoms/Button";
import { TrackRow } from "../molecules/TrackRow";
import { Track } from "../../types/track";

export function MusicLibrary() {
  const { data: tracks = [], isLoading } = useLibrary();
  const { mutate: scanFolder, isPending } = useScanFolder();
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const [search, setSearch] = useState("");

  const filtered = tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.artist.toLowerCase().includes(search.toLowerCase()) ||
      t.album.toLowerCase().includes(search.toLowerCase())
  );

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
      <div className="px-10 pt-9 pb-0 sticky top-0 bg-[#0e0d0b] z-10">
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

      {/* Track list */}
      <div className="flex-1 overflow-y-auto px-10 py-4 scrollbar-thin scrollbar-thumb-[#2a2820]">
        {isLoading && (
          <p className="text-center text-[#3a3628] text-sm mt-20">
            Loading library...
          </p>
        )}

        {!isLoading && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <p className="text-[#3a3628] text-sm">Your library is empty</p>
            <p className="text-[#3a3628] text-xs">
              Click "Add folder" to scan your music
            </p>
          </div>
        )}

        {filtered.map((track, index) => (
          <TrackRow
            key={track.path}
            track={track}
            index={index}
            isActive={currentTrack?.path === track.path}
            onClick={() => handlePlay(track, index)}
          />
        ))}
      </div>
    </div>
  );
}