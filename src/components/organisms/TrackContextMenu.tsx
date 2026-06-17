import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { bumpArtworkEpoch } from "../../hooks/useArtwork";
import { useContextMenuStore } from "../../store/contextMenuStore";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Track } from "../../types/track";
import { usePlaylists, useCreatePlaylist, useAddToPlaylist, useRemoveFromPlaylist } from "../../hooks/usePlaylist";

// ─── Shared primitives ────────────────────────────────────────────────────────

function MenuItem({
  icon, label, onClick, danger, disabled, soon,
}: {
  icon: React.ReactNode; label: string;
  onClick?: () => void; danger?: boolean; disabled?: boolean; soon?: boolean;
}) {
  return (
    <button
      onClick={disabled || soon ? undefined : onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left transition-colors ${
        disabled || soon
          ? "text-[#2e2c24] cursor-default"
          : danger
          ? "text-[#c85858] hover:bg-[#c85858]/10"
          : "text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8]"
      }`}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      <span className="flex-1">{label}</span>
      {soon && <span className="text-[9px] font-mono text-[#2a2820] ml-auto">soon</span>}
    </button>
  );
}

function Sep() {
  return <div className="h-px bg-white/5 my-1 mx-1" />;
}

// ─── Add-to-playlist submenu ──────────────────────────────────────────────────

function AddToPlaylistPanel({
  track,
  onBack,
  onDone,
}: {
  track: Track;
  onBack: () => void;
  onDone: () => void;
}) {
  const { data: playlists = [] } = usePlaylists();
  const addMutation = useAddToPlaylist();
  const createMutation = useCreatePlaylist();
  const { show: showToast } = useToastStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  async function addToPlaylist(playlistId: number, playlistName: string) {
    await addMutation.mutateAsync({ playlistId, trackPaths: [track.path] });
    showToast(`Added to ${playlistName}`);
    onDone();
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    const id = await createMutation.mutateAsync(name);
    await addMutation.mutateAsync({ playlistId: id as unknown as number, trackPaths: [track.path] });
    showToast(`Added to ${name}`);
    onDone();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-2.5 border-b border-white/5">
        <button
          onClick={onBack}
          className="text-[#5a5448] hover:text-[#c8bfa8] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
        <span className="text-[10px] font-mono text-[#7a7060] uppercase tracking-wider">Add to Playlist</span>
      </div>

      {/* New playlist inline */}
      {creating ? (
        <div className="px-2 py-2 flex gap-1.5">
          <input
            ref={newInputRef}
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createAndAdd();
              if (e.key === "Escape") setCreating(false);
              e.stopPropagation();
            }}
            placeholder="Playlist name…"
            className="flex-1 bg-[#1f1d18] border border-[var(--accent-a30)] rounded-lg px-2 py-1 text-xs text-[#f0ead8] placeholder-[#3a3628] outline-none font-mono"
          />
          <button
            onClick={createAndAdd}
            className="px-2 py-1 rounded-lg bg-[var(--accent)] text-[9px] font-mono"
            style={{ color: "var(--accent-on)" }}
          >
            Create
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setCreating(true); setTimeout(() => newInputRef.current?.focus(), 10); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#7a7060] hover:text-[var(--accent)] hover:bg-[#2a2820] rounded-lg transition-colors text-left"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          New Playlist…
        </button>
      )}

      {/* Existing playlists */}
      {playlists.length > 0 && (
        <>
          <div className="h-px bg-white/5 my-1 mx-1" />
          <div className="max-h-[180px] overflow-y-auto">
            {playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => addToPlaylist(pl.id, pl.name)}
                className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs text-[#c8bfa8] hover:bg-[#2a2820] hover:text-[#f0ead8] transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-50">
                    <path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41-2.83L13 14.59 14.59 16l4-4-4-4-1.41 1.41L15.17 11l-1.76 1.17z"/>
                  </svg>
                  <span className="truncate">{pl.name}</span>
                </div>
                <span className="text-[10px] text-[#3a3628] font-mono shrink-0">{pl.track_count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {playlists.length === 0 && !creating && (
        <p className="text-[10px] text-[#3a3628] px-3 py-2 font-mono">No playlists yet</p>
      )}
    </div>
  );
}

// ─── Context menu dropdown ────────────────────────────────────────────────────

function ContextMenuPanel({
  track, x, y, onMetadata, onCover,
}: {
  track: Track; x: number; y: number;
  onMetadata: () => void; onCover: () => void;
}) {
  const hide = useContextMenuStore((s) => s.hide);
  const playlistId = useContextMenuStore((s) => s.playlistId);
  const { playNext, addToQueue } = usePlayerStore();
  const { show: showToast } = useToastStore();
  const queryClient = useQueryClient();
  const removeMutation = useRemoveFromPlaylist();
  const menuRef = useRef<HTMLDivElement>(null);
  const [deleteStep, setDeleteStep] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removeStep, setRemoveStep] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  // Clamp position to viewport
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const bottomOffset = window.innerWidth < 640 ? 136 : 8;
    setPos({
      left: Math.min(x, window.innerWidth  - w - 8),
      top:  Math.min(y, window.innerHeight - h - bottomOffset),
    });
  }, [x, y, playlistOpen]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await invoke("remove_track", { path: track.path });
      // Drop it from the play queue too (handles multiple copies + the now-playing case).
      usePlayerStore.getState().removeTrackEverywhere(track.path);
      // Refresh every view derived from the tracks table.
      [
        "tracks-page", "tracks-count", "tracks-ordered", "track-paths-ordered",
        "albums", "artists", "genres", "genre-stats", "library-stats",
        "album-tracks",
      ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      // Clear MusicLibrary's in-memory page cache (a plain ref that invalidation
      // alone won't touch) so the removed row actually drops from the list.
      window.dispatchEvent(new CustomEvent("library:track-updated"));
      showToast(`Removed — ${track.title}`);
      hide();
    } catch (e) {
      showToast("Couldn't remove — " + String(e).slice(0, 60));
      setDeleting(false);
      setDeleteStep(false);
    }
  }

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.1 }}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 110, minWidth: 210 }}
      className="bg-[#1a1814] border border-white/10 rounded-xl shadow-2xl py-1.5 px-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {playlistOpen ? (
        <AddToPlaylistPanel
          track={track}
          onBack={() => setPlaylistOpen(false)}
          onDone={hide}
        />
      ) : (
        <>
          {/* Track info header */}
          <div className="px-3 pt-1.5 pb-2.5">
            <p className="text-xs text-[#f0ead8] truncate font-medium" title={track.title}>{track.title}</p>
            <p className="text-[10px] text-[#5a5448] truncate mt-0.5">{track.artist}{track.album ? ` · ${track.album}` : ""}</p>
          </div>
          <Sep />

          {deleteStep ? (
            <div className="px-2 py-1">
              <p className="text-xs text-[#c8bfa8] px-1 mb-2">Remove from library?</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setDeleteStep(false)}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-[#c85858] hover:bg-[#d96868] text-white transition-colors font-mono disabled:opacity-50"
                >
                  {deleting ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          ) : removeStep ? (
            <div className="px-2 py-1">
              <p className="text-xs text-[#c8bfa8] px-1 mb-2">Remove from playlist?</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setRemoveStep(false)}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    removeMutation.mutate({ playlistId: playlistId!, trackPath: track.path });
                    showToast("Removed from playlist");
                    hide();
                  }}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-[#c85858] hover:bg-[#d96868] text-white transition-colors font-mono"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem
                onClick={() => { playNext(track); showToast(`Playing next — ${track.title}`); hide(); }}
                label="Play Next"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg>}
              />
              <MenuItem
                onClick={() => { addToQueue(track); showToast(`Added to queue — ${track.title}`); hide(); }}
                label="Add to Queue"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>}
              />
              <Sep />
              <MenuItem
                onClick={() => setPlaylistOpen(true)}
                label="Add to Playlist"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41-2.83L13 14.59 14.59 16l4-4-4-4-1.41 1.41L15.17 11l-1.76 1.17z"/></svg>}
              />
              {playlistId !== null && (
                <MenuItem
                  onClick={() => setRemoveStep(true)}
                  label="Remove from Playlist"
                  danger
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>}
                />
              )}
              <Sep />
              <MenuItem
                onClick={() => { onCover(); }}
                label="Change Cover…"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>}
              />
              <MenuItem
                onClick={() => { onMetadata(); }}
                label="Edit Metadata…"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>}
              />
              <Sep />
              <MenuItem
                onClick={() => setDeleteStep(true)}
                label="Remove from Library"
                danger
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>}
              />
            </>
          )}
        </>
      )}
    </motion.div>
  );
}

// ─── Metadata modal ───────────────────────────────────────────────────────────

function MetadataModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({
    title: track.title,
    artist: track.artist,
    album_artist: track.album_artist,
    album: track.album,
    year: track.year?.toString() ?? "",
    genre: track.genre,
    track_number: track.track_number?.toString() ?? "",
    track_total: track.track_total?.toString() ?? "",
    disc_number: track.disc_number?.toString() ?? "",
    disc_total: track.disc_total?.toString() ?? "",
  });

  // Prevent backdrop-click from firing when the user drags text and releases outside the modal
  const modalRef = useRef<HTMLDivElement>(null);
  const mousedownOriginRef = useRef<EventTarget | null>(null);

  function set(key: keyof typeof fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await invoke("update_track_metadata", {
        path: track.path,
        title: fields.title,
        artist: fields.artist,
        albumArtist: fields.album_artist,
        album: fields.album,
        year: fields.year ? parseInt(fields.year) : null,
        genre: fields.genre || null,
        trackNumber: fields.track_number ? parseInt(fields.track_number) : null,
        trackTotal: fields.track_total ? parseInt(fields.track_total) : null,
        discNumber: fields.disc_number ? parseInt(fields.disc_number) : null,
        discTotal: fields.disc_total ? parseInt(fields.disc_total) : null,
      });

      // Build updated track with edited values
      const updatedTrack: Track = {
        ...track,
        title: fields.title,
        artist: fields.artist,
        album_artist: fields.album_artist,
        album: fields.album,
        year: fields.year ? parseInt(fields.year) : null,
        genre: fields.genre,
        track_number: fields.track_number ? parseInt(fields.track_number) : null,
        track_total: fields.track_total ? parseInt(fields.track_total) : null,
        disc_number: fields.disc_number ? parseInt(fields.disc_number) : null,
        disc_total: fields.disc_total ? parseInt(fields.disc_total) : null,
      };

      // Directly patch the album-tracks cache so AlbumView updates instantly
      queryClient.setQueryData<Track[]>(
        ["album-tracks", track.album, track.album_artist],
        (old) => old?.map((t) => (t.path === track.path ? updatedTrack : t)),
      );

      // Mark caches stale so fetchQuery re-fetches after pagesRef is cleared
      queryClient.invalidateQueries({ queryKey: ["album-tracks"] });
      queryClient.invalidateQueries({ queryKey: ["tracks-page"] });
      queryClient.invalidateQueries({ queryKey: ["tracks-count"] });
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      queryClient.invalidateQueries({ queryKey: ["genres"] });

      // Signal MusicLibrary to clear pagesRef and reload visible pages.
      // dispatchEvent is synchronous — the handler fires before onClose unmounts this component.
      window.dispatchEvent(new CustomEvent("library:track-updated"));

      // Bypass React's hook scheduler: call the store method directly so the
      // toast fires even after onClose triggers unmount.
      useToastStore.getState().show(`Saved — ${fields.title || track.title}`);
      onClose();
    } catch (err) {
      console.error("update_track_metadata failed:", err);
      setError(String(err));
      setSaving(false);
    }
  }

  const inputCls = "w-full bg-[#1f1d18] border border-white/5 focus:border-[var(--accent-a30)] text-[#f0ead8] text-xs px-2.5 py-1.5 rounded-lg outline-none transition-colors placeholder-[#3a3628]";
  const labelCls = "text-[10px] font-mono text-[#5a5448] uppercase tracking-wider mb-1 block";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center"
      onMouseDown={(e) => { mousedownOriginRef.current = e.target; }}
      onClick={() => { if (!modalRef.current?.contains(mousedownOriginRef.current as Node)) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        ref={modalRef}
        initial={{ scale: 0.94, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 12 }}
        transition={{ type: "spring", stiffness: 400, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 bg-[#161410] border border-white/8 rounded-2xl shadow-2xl p-6 w-[460px] max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base text-[#f0ead8]" style={{ fontFamily: "Fraunces, serif" }}>Edit Metadata</h3>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>Title</label>
            <input className={inputCls} value={fields.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Artist</label>
              <input className={inputCls} value={fields.artist} onChange={(e) => set("artist", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Album Artist</label>
              <input className={inputCls} value={fields.album_artist} onChange={(e) => set("album_artist", e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Album</label>
            <input className={inputCls} value={fields.album} onChange={(e) => set("album", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Year</label>
              <input className={inputCls} type="number" value={fields.year} onChange={(e) => set("year", e.target.value)} placeholder="e.g. 2024" />
            </div>
            <div>
              <label className={labelCls}>Genre</label>
              <input className={inputCls} value={fields.genre} onChange={(e) => set("genre", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Track</label>
              <div className="flex items-center gap-1.5">
                <input className={inputCls} type="number" value={fields.track_number} onChange={(e) => set("track_number", e.target.value)} placeholder="#" />
                <span className="text-[#3a3628] text-xs shrink-0">of</span>
                <input className={inputCls} type="number" value={fields.track_total} onChange={(e) => set("track_total", e.target.value)} placeholder="total" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Disc</label>
              <div className="flex items-center gap-1.5">
                <input className={inputCls} type="number" value={fields.disc_number} onChange={(e) => set("disc_number", e.target.value)} placeholder="#" />
                <span className="text-[#3a3628] text-xs shrink-0">of</span>
                <input className={inputCls} type="number" value={fields.disc_total} onChange={(e) => set("disc_total", e.target.value)} placeholder="total" />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-[#c85858] mt-3 font-mono">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 text-xs py-2 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-xs py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors font-mono disabled:opacity-40"
            style={{ color: "var(--accent-on)" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Cover crop modal ─────────────────────────────────────────────────────────

const CROP_SIZE = 300;

function CoverModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [nat, setNat] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [cx, setCx] = useState(0);
  const [cy, setCy] = useState(0);
  const [applyTo, setApplyTo] = useState<"track" | "album">("track");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: albumTracks } = useQuery<Track[]>({
    queryKey: ["album-tracks", track.album, track.album_artist],
    queryFn: () => invoke("get_album_tracks", { album: track.album, artist: track.album_artist }),
    enabled: applyTo === "album",
    staleTime: 1000 * 60 * 5,
  });
  const dragRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  const objUrlRef = useRef<string | null>(null);
  const coverModalRef = useRef<HTMLDivElement>(null);
  const coverMousedownRef = useRef<EventTarget | null>(null);

  // minZoom fills the container (short side = CROP_SIZE)
  const minZoom = Math.max(CROP_SIZE / Math.max(nat.w, 1), CROP_SIZE / Math.max(nat.h, 1));
  const maxZoom = minZoom * 5;

  function loadFile(file: File) {
    if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
    const url = URL.createObjectURL(file);
    objUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const mz = Math.max(CROP_SIZE / w, CROP_SIZE / h);
      setNat({ w, h });
      setZoom(mz);
      setCx(w / 2);
      setCy(h / 2);
      setImgSrc(url);
      setError(null);
    };
    img.src = url;
  }

  useEffect(() => () => { if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); }, []);

  const half = (z: number) => CROP_SIZE / (2 * z);

  function clampCenter(nx: number, ny: number, z: number): [number, number] {
    const h = half(z);
    return [
      Math.max(h, Math.min(nat.w - h, nx)),
      Math.max(h, Math.min(nat.h - h, ny)),
    ];
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, cx, cy };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || e.buttons === 0) return;
    const dx = e.clientX - dragRef.current.px;
    const dy = e.clientY - dragRef.current.py;
    const [nx, ny] = clampCenter(
      dragRef.current.cx - dx / zoom,
      dragRef.current.cy - dy / zoom,
      zoom,
    );
    setCx(nx); setCy(ny);
  }

  function handleZoom(newZoom: number) {
    const [nx, ny] = clampCenter(cx, cy, newZoom);
    setZoom(newZoom); setCx(nx); setCy(ny);
  }

  const imgLeft = CROP_SIZE / 2 - cx * zoom;
  const imgTop  = CROP_SIZE / 2 - cy * zoom;

  async function handleApply() {
    if (!imgSrc) return;
    setSaving(true);
    setError(null);

    const canvas = document.createElement("canvas");
    canvas.width = 500; canvas.height = 500;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();

    img.onload = async () => {
      const srcX    = cx - CROP_SIZE / (2 * zoom);
      const srcY    = cy - CROP_SIZE / (2 * zoom);
      const srcSize = CROP_SIZE / zoom;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, 500, 500);
      const base64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];

      try {
        await invoke("set_track_artwork", {
          trackPath: track.path,
          imageBase64: base64,
          applyToAlbum: applyTo === "album",
        });
        bumpArtworkEpoch();
        queryClient.resetQueries({ queryKey: ["artwork"] });
        queryClient.resetQueries({ queryKey: ["artwork-original"] });
        onClose();
      } catch (err) {
        setError(String(err));
        setSaving(false);
      }
    };
    img.onerror = () => { setError("Failed to read image."); setSaving(false); };
    img.src = imgSrc;
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center"
      onMouseDown={(e) => { coverMousedownRef.current = e.target; }}
      onClick={() => { if (!coverModalRef.current?.contains(coverMousedownRef.current as Node)) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        ref={coverModalRef}
        initial={{ scale: 0.94, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 12 }}
        transition={{ type: "spring", stiffness: 400, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 bg-[#161410] border border-white/8 rounded-2xl shadow-2xl p-6 w-[400px]"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base text-[#f0ead8]" style={{ fontFamily: "Fraunces, serif" }}>Change Cover</h3>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        {!imgSrc ? (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/10 hover:border-[var(--accent-a30)] rounded-xl p-10 cursor-pointer transition-colors">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
            <span className="text-xs text-[#5a5448]">Click to select an image</span>
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
          </label>
        ) : (
          <>
            {/* Crop container */}
            <div
              className="relative overflow-hidden rounded-xl mx-auto select-none cursor-grab active:cursor-grabbing"
              style={{ width: CROP_SIZE, height: CROP_SIZE }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => { dragRef.current = null; }}
            >
              <img
                src={imgSrc}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  width: nat.w * zoom,
                  height: nat.h * zoom,
                  maxWidth: "none",
                  maxHeight: "none",
                  left: imgLeft,
                  top: imgTop,
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
              {/* Crop guides */}
              <div className="absolute inset-0 pointer-events-none" style={{
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
                backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
                backgroundSize: "100px 100px",
              }} />
            </div>

            {/* Zoom slider */}
            <div className="flex items-center gap-3 mt-4">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="range" min={minZoom} max={maxZoom} step={0.001} value={zoom}
                onChange={(e) => handleZoom(parseFloat(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </div>

            {/* Apply scope */}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex gap-4">
                {(["track", "album"] as const).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio" name="cover-apply" value={opt}
                      checked={applyTo === opt}
                      onChange={() => setApplyTo(opt)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-xs text-[#c8bfa8]">
                      {opt === "track" ? "This track only" : `Whole album · ${track.album}`}
                    </span>
                  </label>
                ))}
              </div>

              {applyTo === "album" && albumTracks && albumTracks.length > 0 && (
                <div className="mt-1 max-h-[120px] overflow-y-auto rounded-lg border border-white/6 bg-[#0e0d0b]">
                  {albumTracks.map((t) => (
                    <div
                      key={t.path}
                      className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${
                        t.path === track.path
                          ? "text-[var(--accent)] bg-[var(--accent)]/8"
                          : "text-[#7a7060]"
                      }`}
                    >
                      <span className="w-5 text-right shrink-0 opacity-50 font-mono">
                        {t.track_number ?? "·"}
                      </span>
                      <span className="truncate">{t.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Change file */}
            <label className="inline-block mt-2 text-[10px] font-mono text-[#3a3628] hover:text-[#7a7060] cursor-pointer transition-colors">
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
              Choose different image
            </label>
          </>
        )}

        {error && <p className="text-xs text-[#c85858] mt-3 font-mono">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 text-xs py-2 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono">Cancel</button>
          <button
            onClick={handleApply}
            disabled={!imgSrc || saving}
            className="flex-1 text-xs py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors font-mono disabled:opacity-30"
            style={{ color: "var(--accent-on)" }}
          >
            {saving ? "Saving…" : "Apply"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

type View = "menu" | "metadata" | "cover";

export function TrackContextMenu() {
  const { track, x, y, hide } = useContextMenuStore();
  const [view, setView] = useState<View>("menu");

  useEffect(() => {
    if (!track) { setView("menu"); return; }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [track]);

  if (!track) return null;

  return (
    <AnimatePresence>
      {view === "menu" && (
        <>
          <div key="backdrop" className="fixed inset-0 z-[100]" onClick={hide} onContextMenu={(e) => { e.preventDefault(); hide(); }} />
          <ContextMenuPanel
            key="menu"
            track={track} x={x} y={y}
            onMetadata={() => setView("metadata")}
            onCover={() => setView("cover")}
          />
        </>
      )}
      {view === "metadata" && (
        <MetadataModal key="metadata" track={track} onClose={hide} />
      )}
      {view === "cover" && (
        <CoverModal key="cover" track={track} onClose={hide} />
      )}
    </AnimatePresence>
  );
}
