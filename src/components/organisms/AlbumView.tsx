import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { Track } from "../../types/track";
import { Album } from "../../types/album";
import { useArtwork } from "../../hooks/useArtwork";
import { usePlayerStore } from "../../store/playerStore";
import { TrackRow } from "../molecules/TrackRow";
import { convertFileSrc } from "@tauri-apps/api/core";

interface AlbumViewProps {
  album: Album;
  onBack: () => void;
}

export function AlbumView({ album, onBack }: AlbumViewProps) {
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const { data: artworkUrl } = useArtwork(album.cover_path);

  const { data: tracks = [] } = useQuery({
    queryKey: ["album-tracks", album.album, album.artist],
    queryFn: () =>
      invoke<Track[]>("get_album_tracks", {
        album: album.album,
        artist: album.artist,
      }),
    staleTime: 1000 * 60 * 5,
  });

  function handlePlayAll() {
    if (tracks.length === 0) return;
    setQueue(tracks, 0);
    setIsPlaying(true);
  }

  function handlePlayTrack(index: number) {
    setQueue(tracks, index);
    setIsPlaying(true);
  }

  const totalDuration = tracks.reduce((sum, t) => sum + t.duration_secs, 0);
  const totalMins = Math.floor(totalDuration / 60);

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b] overflow-y-auto">
      {/* Header */}
      <div className="px-10 pt-9 pb-6">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors mb-8 text-xs font-mono"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          Albums
        </button>

        {/* Album hero */}
        <div className="flex gap-8 items-end">
          {/* Cover */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="w-44 h-44 rounded-xl overflow-hidden bg-[#1f1d18] shrink-0 shadow-2xl"
          >
            {artworkUrl ? (
              <img src={artworkUrl} alt={album.album} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </motion.div>

          {/* Info */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="flex flex-col gap-1 pb-1"
          >
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1">
              Album
            </p>
            <h1
              className="text-[32px] leading-none tracking-[-1px] text-[#faf8f2] font-light"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              {album.album}
            </h1>
            <p className="text-[#c8bfa8] text-sm mt-1">{album.artist}</p>
            <p className="text-[#3a3628] text-xs font-mono mt-1">
              {album.year ? `${album.year} · ` : ""}
              {album.track_count} tracks · {totalMins} min
            </p>

            {/* Play button */}
            <button
              onClick={handlePlayAll}
              className="mt-4 flex items-center gap-2 bg-[#d4872a] hover:bg-[#e8a84c] text-white text-xs font-mono tracking-widest uppercase px-5 py-2.5 rounded-full transition-colors w-fit"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play all
            </button>
          </motion.div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-10 border-t border-white/6 mb-2" />

      {/* Column headers */}
      <div className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 px-10 pb-2 text-[11px] font-mono tracking-widest uppercase text-[#3a3628]">
        <span>Title</span>
        <span>Artist</span>
        <span>Album</span>
        <span className="text-right">Time</span>
      </div>

      {/* Track list */}
      <div className="px-10 pb-8">
        {tracks.map((track, index) => (
          <TrackRow
            key={track.path}
            track={track}
            index={index}
            isActive={currentTrack?.path === track.path}
            onClick={() => handlePlayTrack(index)}
          />
        ))}
      </div>
    </div>
  );
}