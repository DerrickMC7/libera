import { useState } from "react";
import { useAlbums } from "../../hooks/useAlbums";
import { AlbumCard } from "../molecules/AlbumCard";
import { AlbumView } from "./AlbumView";
import { Album } from "../../types/album";

export function AlbumGrid() {
  const { data: albums = [], isLoading } = useAlbums();
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [search, setSearch] = useState("");

  if (selectedAlbum) {
    return (
      <AlbumView
        album={selectedAlbum}
        onBack={() => setSelectedAlbum(null)}
      />
    );
  }

  const filtered = albums.filter(
    (a) =>
      a.album.toLowerCase().includes(search.toLowerCase()) ||
      a.artist.toLowerCase().includes(search.toLowerCase())
  );

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
            Albums{" "}
            <em className="italic text-[#c8bfa8] font-light">
              {albums.length > 0 ? `· ${albums.length}` : ""}
            </em>
          </h1>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search albums, artists..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 mb-6 transition-colors"
        />
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-10 py-4">
        {isLoading && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2.5" style={{ opacity: 1 - i * 0.06 }}>
                <div className="w-full aspect-square rounded-lg bg-[#1f1d18] animate-pulse" />
                <div className="h-3 rounded bg-[#1f1d18] animate-pulse w-3/4" />
                <div className="h-2.5 rounded bg-[#1a1814] animate-pulse w-1/2" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && albums.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <p className="text-[#3a3628] text-sm">No albums yet</p>
            <p className="text-[#3a3628] text-xs">Add a music folder to get started</p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6 pb-8">
            {filtered.map((album) => (
              <AlbumCard
                key={`${album.artist}-${album.album}`}
                album={album}
                onClick={() => setSelectedAlbum(album)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}