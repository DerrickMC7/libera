import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { usePlaylists, usePlaylistTracks, useReorderPlaylist, useRenamePlaylist, useDeletePlaylist } from "../../hooks/usePlaylist";
import { PlaylistCoverModal } from "./PlaylistCoverModal";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { useArtwork } from "../../hooks/useArtwork";
import { TrackRow, TrackRowHeader } from "../molecules/TrackRow";
import { Track } from "../../types/track";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function CoverThumb({ path }: { path: string }) {
  const { data: url } = useArtwork(path, false);
  return url ? (
    <img src={url} alt="" className="w-full h-full object-cover" />
  ) : (
    <div className="w-full h-full flex items-center justify-center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
        <path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41-2.83L13 14.59 14.59 16l4-4-4-4-1.41 1.41L15.17 11l-1.76 1.17z"/>
      </svg>
    </div>
  );
}

function totalDuration(tracks: Track[]) {
  const secs = tracks.reduce((acc, t) => acc + t.duration_secs, 0);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

// ─── Playlist view ────────────────────────────────────────────────────────────

export function PlaylistView({
  playlistId,
  onBack,
}: {
  playlistId: number;
  onBack: () => void;
}) {
  const { data: playlists = [] } = usePlaylists();
  const { data: tracks = [], isLoading } = usePlaylistTracks(playlistId);
  const reorderMutation = useReorderPlaylist();
  const renameMutation = useRenamePlaylist();
  const deleteMutation = useDeletePlaylist();
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const { show: showToast } = useToastStore();

  const playlist = playlists.find((p) => p.id === playlistId);

  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragTrackPathRef = useRef<string | null>(null);
  const dragFromRef = useRef<number | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDeleteStep, setMenuDeleteStep] = useState(false);

  useEffect(() => { setLocalTracks(tracks); }, [tracks]);

  function handlePlayAll() {
    if (localTracks.length === 0) return;
    setQueue(localTracks, 0);
    setIsPlaying(true);
  }

  function handlePlayFrom(idx: number) {
    setQueue(localTracks, idx);
    setIsPlaying(true);
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, idx: number) {
    dragTrackPathRef.current = localTracks[idx].path;
    dragFromRef.current = idx;
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex === null || dragIndex === idx) return;
    const newTracks = [...localTracks];
    const [moved] = newTracks.splice(dragIndex, 1);
    newTracks.splice(idx, 0, moved);
    setLocalTracks(newTracks);
    setDragIndex(idx);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const trackPath = dragTrackPathRef.current;
    const finalIdx = dragIndex;
    const origIdx = dragFromRef.current;
    setDragIndex(null);
    dragTrackPathRef.current = null;
    dragFromRef.current = null;
    if (trackPath && finalIdx !== null && origIdx !== null && origIdx !== finalIdx) {
      reorderMutation.mutate({ playlistId, trackPath, newPosition: finalIdx });
    }
  }

  function handleDragEnd() {
    setDragIndex(null);
  }

  function startRename() {
    setNameValue(playlist?.name ?? "");
    setEditingName(true);
    setTimeout(() => { nameInputRef.current?.select(); }, 10);
  }

  function commitRename() {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== playlist?.name) {
      renameMutation.mutate({ playlistId, name: trimmed });
    }
    setEditingName(false);
  }

  async function handleExport(format: "m3u" | "pls") {
    try {
      const content = await invoke<string>(
        format === "m3u" ? "export_playlist_m3u" : "export_playlist_pls",
        { playlistId }
      );
      const name = playlist?.name ?? "playlist";
      const savePath = await save({
        defaultPath: `${name}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!savePath) return;
      await invoke("write_text_file", { path: savePath, content });
      showToast(`Exported ${name}.${format}`);
      setMenuOpen(false);
    } catch (e) {
      showToast("Export failed — " + String(e).slice(0, 60));
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-10 pt-4 sm:pt-6 pb-4 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[#5a5448] hover:text-[#c8bfa8] text-xs font-mono mb-5 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
          Playlists
        </button>

        <div className="flex items-end gap-5">
          {/* Cover */}
          <div className="w-[90px] h-[90px] shrink-0 rounded-xl overflow-hidden bg-[#1a1814] relative">
            {playlist?.custom_cover ? (
              <img src={`data:image/jpeg;base64,${playlist.custom_cover}`} alt="" className="w-full h-full object-cover" />
            ) : localTracks[0] ? (
              <CoverThumb path={localTracks[0].path} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
                  <path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41-2.83L13 14.59 14.59 16l4-4-4-4-1.41 1.41L15.17 11l-1.76 1.17z"/>
                </svg>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1">
              Playlist
            </p>
            {editingName ? (
              <input
                ref={nameInputRef}
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="text-[32px] leading-none tracking-tight text-[#faf8f2] font-light bg-transparent border-b border-[var(--accent-a30)] outline-none w-full mb-1"
                style={{ fontFamily: "Fraunces, serif" }}
              />
            ) : (
              <h1
                className="text-[32px] leading-none tracking-tight text-[#faf8f2] font-light truncate"
                style={{ fontFamily: "Fraunces, serif" }}
              >
                {playlist?.name ?? "…"}
              </h1>
            )}
            <p className="text-xs text-[#5a5448] mt-1.5 font-mono">
              {localTracks.length === 0
                ? "Empty playlist"
                : `${localTracks.length} track${localTracks.length !== 1 ? "s" : ""} · ${totalDuration(localTracks)}`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-5 shrink-0">
            {/* Three-dot menu */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); setMenuDeleteStep(false); }}
                className="w-8 h-8 rounded-lg bg-[#1a1814] hover:bg-[#222018] text-[#5a5448] hover:text-[#c8bfa8] flex items-center justify-center transition-colors"
              >
                <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" style={{ display: "block" }}>
                  <circle cx="2" cy="2" r="1.5"/>
                  <circle cx="2" cy="8" r="1.5"/>
                  <circle cx="2" cy="14" r="1.5"/>
                </svg>
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[100]"
                      onClick={() => { setMenuOpen(false); setMenuDeleteStep(false); }}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.1 }}
                      className="absolute right-0 top-full mt-1.5 z-[110] bg-[#1a1814] border border-white/10 rounded-xl shadow-2xl py-1.5 px-1.5 min-w-[180px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {menuDeleteStep ? (
                        <div className="px-2 py-1">
                          <p className="text-xs text-[#c8bfa8] px-1 mb-2">Delete this playlist?</p>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setMenuDeleteStep(false)}
                              className="flex-1 text-xs py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={async () => {
                                await deleteMutation.mutateAsync(playlistId);
                                onBack();
                              }}
                              className="flex-1 text-xs py-1.5 rounded-lg bg-[#c85858] hover:bg-[#d96868] text-white transition-colors font-mono"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => { startRename(); setMenuOpen(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors text-left"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                            </svg>
                            Rename
                          </button>
                          <button
                            onClick={() => { setCoverModalOpen(true); setMenuOpen(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors text-left"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
                              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                            </svg>
                            Change Cover…
                          </button>
                          <button
                            onClick={() => handleExport("m3u")}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors text-left"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
                              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                            </svg>
                            Export as M3U
                          </button>
                          <button
                            onClick={() => handleExport("pls")}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors text-left"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
                              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                            </svg>
                            Export as PLS
                          </button>
                          <div className="h-px bg-white/5 my-1 mx-1" />
                          <button
                            onClick={() => setMenuDeleteStep(true)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#c85858] hover:bg-[#c85858]/10 transition-colors text-left"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                            Delete Playlist
                          </button>
                        </>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {localTracks.length > 0 && (
              <button
                onClick={handlePlayAll}
                className="w-11 h-11 rounded-full bg-[var(--accent)] flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                style={{ color: "var(--accent-on)" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Track list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-10 pb-6">
        {isLoading && (
          <div className="space-y-1 pt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
                <div className="w-5 h-3 rounded bg-[#1a1814] animate-pulse shrink-0" />
                <div className="w-8 h-8 rounded bg-[#1a1814] animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 rounded bg-[#1a1814] animate-pulse w-2/3" />
                  <div className="h-2.5 rounded bg-[#161410] animate-pulse w-1/3" />
                </div>
                <div className="h-3 w-8 rounded bg-[#1a1814] animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && localTracks.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-16 gap-2">
            <p className="text-[#3a3628] text-sm">No tracks yet</p>
            <p className="text-[#2a2820] text-xs">Right-click any track and choose "Add to Playlist"</p>
          </div>
        )}

        {!isLoading && localTracks.length > 0 && (
          <div className="pt-2">
            <TrackRowHeader showDragHandle showArtistColumn showAlbumColumn />

            {localTracks.map((track, idx) => (
              <motion.div key={track.path + idx} layout>
                <TrackRow
                  track={track}
                  isActive={currentTrack?.path === track.path}
                  onDoubleClick={() => handlePlayFrom(idx)}
                  showDragHandle
                  showArtistColumn
                  showAlbumColumn
                  playlistId={playlistId}
                  draggable
                  isDragging={dragIndex === idx}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Cover modal */}
      <AnimatePresence>
        {coverModalOpen && (
          <PlaylistCoverModal
            playlistId={playlistId}
            onClose={() => setCoverModalOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
