import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { usePlaylists, useCreatePlaylist, useDeletePlaylist, useRenamePlaylist } from "../../hooks/usePlaylist";
import { useArtwork } from "../../hooks/useArtwork";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { PlaylistCoverModal } from "./PlaylistCoverModal";
import { Playlist } from "../../types/playlist";
import { Track } from "../../types/track";

// ─── Shared primitives ────────────────────────────────────────────────────────

function MenuItem({
  icon, label, onClick, danger,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left transition-colors ${
        danger
          ? "text-[#c85858] hover:bg-[#c85858]/10"
          : "text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8]"
      }`}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Sep() {
  return <div className="h-px bg-white/5 my-1 mx-1" />;
}

// ─── Playlist cover display ───────────────────────────────────────────────────

function PlaylistCover({ coverPath, customCover }: { coverPath: string; customCover: string | null }) {
  const { data: artworkUrl } = useArtwork(!customCover ? (coverPath || undefined) : undefined, false);
  if (customCover) {
    return <img src={`data:image/jpeg;base64,${customCover}`} alt="" className="w-full h-full object-cover" />;
  }
  return artworkUrl ? (
    <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
  ) : (
    <div className="w-full h-full flex items-center justify-center">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
        <path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41-2.83L13 14.59 14.59 16l4-4-4-4-1.41 1.41L15.17 11l-1.76 1.17z"/>
      </svg>
    </div>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function PlaylistContextMenu({
  playlist, x, y, onClose, onPlay, onOpen, onRename, onChangeCover, onDelete,
}: {
  playlist: Playlist; x: number; y: number;
  onClose: () => void; onPlay: () => void; onOpen: () => void;
  onRename: () => void; onChangeCover: () => void; onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [deleteStep, setDeleteStep] = useState(false);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth  - w - 8),
      top:  Math.min(y, window.innerHeight - h - 8),
    });
  }, [x, y]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.1 }}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 110, minWidth: 200 }}
      className="bg-[#1a1814] border border-white/10 rounded-xl shadow-2xl py-1.5 px-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 pt-1.5 pb-2.5">
        <p className="text-xs text-[#f0ead8] truncate font-medium">{playlist.name}</p>
        <p className="text-[10px] text-[#5a5448] mt-0.5">
          {playlist.track_count === 0 ? "Empty playlist" : `${playlist.track_count} track${playlist.track_count !== 1 ? "s" : ""}`}
        </p>
      </div>
      <Sep />

      {deleteStep ? (
        <div className="px-2 py-1">
          <p className="text-xs text-[#c8bfa8] px-1 mb-2">Delete this playlist?</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setDeleteStep(false)}
              className="flex-1 text-xs py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono"
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              className="flex-1 text-xs py-1.5 rounded-lg bg-[#c85858] hover:bg-[#d96868] text-white transition-colors font-mono"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <>
          <MenuItem
            onClick={onPlay}
            label="Play"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
          />
          <MenuItem
            onClick={onOpen}
            label="Open"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41-2.83L13 14.59 14.59 16l4-4-4-4-1.41 1.41L15.17 11l-1.76 1.17z"/></svg>}
          />
          <Sep />
          <MenuItem
            onClick={onRename}
            label="Rename"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>}
          />
          <MenuItem
            onClick={onChangeCover}
            label="Change Cover…"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>}
          />
          <Sep />
          <MenuItem
            onClick={() => setDeleteStep(true)}
            label="Delete Playlist"
            danger
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>}
          />
        </>
      )}
    </motion.div>
  );
}

// ─── Playlist card ────────────────────────────────────────────────────────────

function PlaylistCard({
  playlist, onClick, onPlay, onContextMenu, renaming, onRenameCommit, onRenameCancel,
}: {
  playlist: Playlist; onClick: () => void; onPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  renaming: boolean; onRenameCommit: (name: string) => void; onRenameCancel: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [renameValue, setRenameValue] = useState(playlist.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setRenameValue(playlist.name);
      setTimeout(() => inputRef.current?.select(), 10);
    }
  }, [renaming, playlist.name]);

  return (
    <div
      className="cursor-pointer"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => { if (!renaming) onClick(); }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e); }}
    >
      <div className="relative rounded-xl bg-[#1a1814]" style={{ aspectRatio: "1" }}>
        <div className="absolute inset-0 rounded-xl overflow-hidden">
          <PlaylistCover coverPath={playlist.cover_path} customCover={playlist.custom_cover} />
          <AnimatePresence>
            {hovering && !renaming && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="absolute inset-0 bg-black/45 flex items-center justify-center"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onPlay(); }}
                  className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center shadow-xl hover:scale-105 transition-transform"
                  style={{ color: "var(--accent-on)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-2.5 px-0.5">
        {renaming ? (
          <input
            ref={inputRef}
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => onRenameCommit(renameValue)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameCommit(renameValue);
              if (e.key === "Escape") onRenameCancel();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-[#1f1d18] border border-[var(--accent-a30)] rounded-lg px-2 py-1 text-xs text-[#f0ead8] outline-none font-mono"
          />
        ) : (
          <p className="text-sm text-[#f0ead8] truncate">{playlist.name}</p>
        )}
        <p className="text-[11px] text-[#5a5448] mt-0.5">
          {playlist.track_count === 0 ? "Empty" : `${playlist.track_count} track${playlist.track_count !== 1 ? "s" : ""}`}
        </p>
      </div>
    </div>
  );
}

// ─── Playlist list ────────────────────────────────────────────────────────────

export function PlaylistList({ onOpen }: { onOpen: (id: number) => void }) {
  const { data: playlists = [], isLoading } = usePlaylists();
  const createMutation = useCreatePlaylist();
  const deleteMutation = useDeletePlaylist();
  const renameMutation = useRenamePlaylist();
  const { setQueue, setIsPlaying } = usePlayerStore();
  const { show: showToast } = useToastStore();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  const [ctxMenu, setCtxMenu] = useState<{ playlist: Playlist; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [coverModalId, setCoverModalId] = useState<number | null>(null);

  function startCreate() {
    setCreating(true);
    setNewName("");
    setTimeout(() => newInputRef.current?.focus(), 10);
  }

  async function commitCreate() {
    const trimmed = newName.trim();
    if (trimmed) await createMutation.mutateAsync(trimmed);
    setCreating(false);
  }

  async function handlePlay(playlist: Playlist) {
    try {
      const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId: playlist.id });
      if (tracks.length > 0) { setQueue(tracks, 0); setIsPlaying(true); }
    } catch (e) {
      showToast("Couldn't load playlist — " + String(e).slice(0, 60));
    }
  }

  function closeCtx() { setCtxMenu(null); }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 sm:px-10 py-4 sm:py-6" onClick={closeCtx}>
      {/* New playlist button */}
      <div className="mb-8">
        {creating ? (
          <div className="flex items-center gap-2">
            <input
              ref={newInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setCreating(false); else commitCreate(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Playlist name…"
              className="bg-[#1f1d18] border border-[var(--accent-a30)] rounded-lg px-3 py-2 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none font-mono w-56"
            />
            <button
              onClick={commitCreate}
              className="px-3 py-2 rounded-lg bg-[var(--accent)] text-xs font-mono transition-colors"
              style={{ color: "var(--accent-on)" }}
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-2 rounded-lg bg-[#1f1d18] text-xs font-mono text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={startCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1a1814] border border-white/6 hover:border-[var(--accent-a30)] text-[#7a7060] hover:text-[var(--accent)] transition-all text-sm font-mono"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            New Playlist
          </button>
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-square rounded-xl bg-[#1a1814] animate-pulse" />
              <div className="h-3.5 rounded bg-[#1a1814] animate-pulse w-3/4" />
              <div className="h-2.5 rounded bg-[#161410] animate-pulse w-1/2" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && playlists.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 mt-20">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
            <path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41-2.83L13 14.59 14.59 16l4-4-4-4-1.41 1.41L15.17 11l-1.76 1.17z"/>
          </svg>
          <p className="text-[#3a3628] text-sm">No playlists yet</p>
          <p className="text-[#2a2820] text-xs">Create one or right-click a track to add it</p>
        </div>
      )}

      {!isLoading && playlists.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
          {playlists.map((pl) => (
            <PlaylistCard
              key={pl.id}
              playlist={pl}
              onClick={() => onOpen(pl.id)}
              onPlay={() => handlePlay(pl)}
              onContextMenu={(e) => { e.stopPropagation(); setCtxMenu({ playlist: pl, x: e.clientX, y: e.clientY }); }}
              renaming={renamingId === pl.id}
              onRenameCommit={(name) => {
                const trimmed = name.trim();
                if (trimmed && trimmed !== pl.name) renameMutation.mutate({ playlistId: pl.id, name: trimmed });
                setRenamingId(null);
              }}
              onRenameCancel={() => setRenamingId(null)}
            />
          ))}
        </div>
      )}

      {/* Context menu */}
      <AnimatePresence>
        {ctxMenu && (
          <>
            <div
              className="fixed inset-0 z-[100]"
              onClick={closeCtx}
              onContextMenu={(e) => { e.preventDefault(); closeCtx(); }}
            />
            <PlaylistContextMenu
              playlist={ctxMenu.playlist}
              x={ctxMenu.x}
              y={ctxMenu.y}
              onClose={closeCtx}
              onPlay={() => { handlePlay(ctxMenu.playlist); closeCtx(); }}
              onOpen={() => { onOpen(ctxMenu.playlist.id); closeCtx(); }}
              onRename={() => { setRenamingId(ctxMenu.playlist.id); closeCtx(); }}
              onChangeCover={() => { setCoverModalId(ctxMenu.playlist.id); closeCtx(); }}
              onDelete={() => { deleteMutation.mutate(ctxMenu.playlist.id); closeCtx(); }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Cover change modal */}
      <AnimatePresence>
        {coverModalId !== null && (
          <PlaylistCoverModal
            playlistId={coverModalId}
            onClose={() => setCoverModalId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
