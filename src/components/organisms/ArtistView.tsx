import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useArtistDetails } from "../../hooks/useArtists";
import { useArtwork } from "../../hooks/useArtwork";
import { useArtistImage } from "../../hooks/useArtistImage";
import { useArtistBanner } from "../../hooks/useArtistBanner";
import { usePlayerStore } from "../../store/playerStore";
import { useNavigationStore } from "../../store/navigationStore";
import { TrackRow } from "../molecules/TrackRow";
import { ArtistBannerModal } from "./ArtistBannerModal";
import { Artist } from "../../types/artist";
import { Track } from "../../types/track";

interface ArtistViewProps {
  artist: Artist;
  onBack: () => void;
}

function AlbumCover({ path }: { path: string }) {
  const { data: artworkUrl } = useArtwork(path, true);
  return (
    <div className="w-10 h-10 rounded bg-[#1f1d18] shrink-0 overflow-hidden">
      {artworkUrl ? (
        <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function ArtistView({ artist, onBack }: ArtistViewProps) {
  const { data: albums = [], isLoading } = useArtistDetails(artist.name);
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const navigateToAlbum = useNavigationStore((s) => s.navigateToAlbum);
  const queryClient = useQueryClient();

  const { data: artistBannerUrl } = useArtistBanner(artist.name);
  const { data: artistImageUrl } = useArtistImage(artist.name);
  const { data: fallbackArtworkUrl } = useArtwork(artist.cover_path, true);
  const bannerUrl = artistBannerUrl ?? artistImageUrl ?? fallbackArtworkUrl;

  const { data: isCustomBanner } = useQuery({
    queryKey: ["artist-banner-custom", artist.name],
    queryFn: () => invoke<boolean>("is_artist_banner_custom", { artistName: artist.name }),
    staleTime: Infinity,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  async function handleResetBanner() {
    try {
      await invoke("clear_artist_banner_custom", { artistName: artist.name });
      queryClient.invalidateQueries({ queryKey: ["artist-banner", artist.name] });
      queryClient.invalidateQueries({ queryKey: ["artist-banner-custom", artist.name] });
    } catch (e) {
      console.error("Failed to reset banner", e);
    }
  }

  const allTracks = albums.flatMap((a) => a.tracks);

  function handlePlayAll() {
    if (allTracks.length === 0) return;
    setQueue(allTracks, 0);
    setIsPlaying(true);
  }

  function handlePlayTrack(track: Track, albumTracks: Track[]) {
    setQueue(albumTracks, albumTracks.indexOf(track));
    setIsPlaying(true);
  }

  return (
    <>
    <div className="flex flex-col h-full bg-[#0e0d0b] overflow-y-auto">
      <div
        className="relative w-full shrink-0 overflow-hidden"
        style={{ aspectRatio: "3/1", maxHeight: "500px" }}
      >
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt={artist.name}
            className="absolute inset-0 w-full h-full object-cover block"
            style={{ filter: "brightness(0.65)" }}
          />
        ) : (
          <div className="absolute inset-0 bg-[#1a1814]" />
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/10 to-[#0e0d0b]" />

        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 sm:top-5 sm:left-8 flex items-center gap-1.5 text-[#c8bfa8]/80 hover:text-[#c8bfa8] transition-colors text-xs font-mono z-10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          Artists
        </button>

        {/* Pen icon → dropdown menu */}
        <div className="absolute top-4 right-4 sm:top-5 sm:right-8 z-10" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="Edit banner"
            className="p-1.5 rounded-md bg-black/30 text-[#c8bfa8]/60 hover:text-[#c8bfa8] hover:bg-black/50 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-[#1a1814] border border-white/10 rounded-xl shadow-2xl py-1 min-w-[148px]">
              <button
                onClick={() => { setMenuOpen(false); setCropModalOpen(true); }}
                className="w-full text-left px-3 py-2 text-xs text-[#c8bfa8] hover:bg-white/5 transition-colors font-mono flex items-center gap-2.5"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-[#7a7060]">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
                Set banner
              </button>
              {isCustomBanner && (
                <button
                  onClick={() => { setMenuOpen(false); handleResetBanner(); }}
                  className="w-full text-left px-3 py-2 text-xs text-[#7a7060] hover:bg-white/5 hover:text-[#c8bfa8] transition-colors font-mono flex items-center gap-2.5"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                    <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                  </svg>
                  Reset to auto
                </button>
              )}
            </div>
          )}
        </div>

        {/* Artist name */}
        <div className="absolute bottom-4 sm:bottom-6 left-4 sm:left-10 z-10">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-2">Artist</p>
          <h1
            className="text-[32px] sm:text-[48px] leading-none tracking-[-1px] sm:tracking-[-1.5px] font-light drop-shadow-xl"
            style={{ fontFamily: "Fraunces, serif", textShadow: "0 2px 16px rgba(0,0,0,0.7)", color: "white" }}
          >
            {artist.name}
          </h1>
        </div>
      </div>

      {/* Stats + play all */}
      <div className="px-4 sm:px-10 pt-4 sm:pt-5 pb-4 sm:pb-6">
        <div className="flex items-center gap-5">
          <button
            onClick={handlePlayAll}
            className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono tracking-widest uppercase px-5 py-2.5 rounded-full transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play all
          </button>
          <p className="text-[#3a3628] text-xs font-mono">
            {artist.album_count} {artist.album_count === 1 ? "album" : "albums"} · {artist.track_count} tracks
          </p>
        </div>
        <div className="border-t border-white/6 mt-5" />
      </div>

      {/* Albums and tracks */}
      <div className="px-4 sm:px-10 pb-8">
        {isLoading && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <div className="h-4 rounded bg-[#1f1d18] animate-pulse w-48 mb-3" />
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-10 rounded bg-[#1a1814] animate-pulse mb-1" />
                ))}
              </div>
            ))}
          </div>
        )}

        {albums.map((albumData) => (
          <div key={albumData.album} className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <AlbumCover path={albumData.cover_path} />
              <div>
                <p
                  className="text-sm text-[#f0ead8] hover:text-[var(--accent)] cursor-pointer transition-colors"
                  style={{ fontFamily: "Georgia, serif" }}
                  onClick={() => navigateToAlbum(albumData.album, artist.name)}
                >
                  {albumData.album}
                </p>
                <p className="text-xs text-[#3a3628] font-mono">
                  {albumData.year ?? "Unknown year"} · {albumData.track_count} tracks
                </p>
              </div>
            </div>

            <div className="border-t border-white/5">
              {albumData.tracks.map((track, idx) => (
                <TrackRow
                  key={track.path}
                  track={track}
                  isActive={currentTrack?.path === track.path}
                  onClick={() => handlePlayTrack(track, albumData.tracks)}
                  showTrackNumber
                  showArtwork={false}
                  showArtistColumn={false}
                  trackNumber={track.track_number ?? idx + 1}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>

    <AnimatePresence>
      {cropModalOpen && (
        <ArtistBannerModal
          artistName={artist.name}
          onClose={() => setCropModalOpen(false)}
        />
      )}
    </AnimatePresence>
    </>
  );
}
