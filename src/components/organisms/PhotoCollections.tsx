import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Photo, PhotoCollection } from "../../types/photo";
import {
  usePhotoCollections,
  useCreatePhotoCollection,
  useDeletePhotoCollection,
  useRenamePhotoCollection,
  useCollectionPhotos,
  useRemoveFromCollection,
} from "../../hooks/usePhotos";
import { usePhotoStore } from "../../store/photoStore";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

function getImgSrc(path: string): string {
  return IS_DEMO ? path : convertFileSrc(path);
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function CollectionDetail({ collection, onBack }: { collection: PhotoCollection; onBack: () => void }) {
  const { data: photos = [], isLoading } = useCollectionPhotos(collection.id);
  const { mutate: removePhoto } = useRemoveFromCollection();
  const { openLightbox } = usePhotoStore();
  const [removing, setRemoving] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState<120 | 160 | 220>(160);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 sm:px-10 pt-4 sm:pt-6 pb-4 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors mb-4"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All Collections
        </button>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[#f0ead8] text-2xl font-medium" style={{ fontFamily: "Fraunces, serif" }}>
              {collection.name}
            </h2>
            {collection.description && (
              <p className="text-[#5a5244] text-xs mt-1">{collection.description}</p>
            )}
            <p className="text-[#3a3628] text-xs font-mono mt-1">
              {photos.length} photo{photos.length !== 1 ? "s" : ""} · Created {formatDate(collection.created_at)}
            </p>
          </div>
          {photos.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center border border-white/7 rounded-lg overflow-hidden">
                {([120, 160, 220] as const).map((s, i) => (
                  <button
                    key={s}
                    onClick={() => setThumbSize(s)}
                    title={s === 120 ? "Small" : s === 160 ? "Medium" : "Large"}
                    className={`px-2.5 py-1.5 transition-colors ${thumbSize === s ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"} ${i > 0 ? "border-l border-white/7" : ""}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      {s === 120 ? (
                        <><rect x="2" y="2" width="9" height="9" rx="1"/><rect x="13" y="2" width="9" height="9" rx="1"/><rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/></>
                      ) : s === 160 ? (
                        <><rect x="2" y="2" width="11" height="11" rx="1"/><rect x="15" y="2" width="7" height="7" rx="1"/><rect x="2" y="15" width="7" height="7" rx="1"/><rect x="15" y="15" width="7" height="7" rx="1"/></>
                      ) : (
                        <><rect x="2" y="2" width="20" height="9" rx="1"/><rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/></>
                      )}
                    </svg>
                  </button>
                ))}
              </div>
              <button
                onClick={() => openLightbox(photos, 0)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)] text-xs font-mono transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Slideshow
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-10 pb-6">
        {isLoading ? (
          <div className="flex justify-center pt-12">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 15l5-5 4 4 2-2 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <p className="text-[#5a5244] text-sm">This collection is empty</p>
            <p className="text-[#3a3628] text-xs">Select photos and use "Add to Collection" to populate it</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <AnimatePresence>
              {photos.map((photo, i) => (
                <motion.div
                  key={photo.path}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  className="relative group rounded-lg overflow-hidden cursor-pointer shrink-0"
                  style={{ width: thumbSize, height: thumbSize }}
                  onClick={() => openLightbox(photos, i)}
                >
                  <img
                    src={getImgSrc(photo.path)}
                    alt={photo.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <p className="absolute bottom-2 left-2 right-2 text-white text-xs truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {photo.name}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemoving(photo.path);
                      removePhoto(
                        { collectionId: collection.id, path: photo.path },
                        { onSettled: () => setRemoving(null) }
                      );
                    }}
                    disabled={removing === photo.path}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 text-white/80 hover:bg-red-500 hover:text-white transition-colors items-center justify-center hidden group-hover:flex"
                    title="Remove from collection"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

export function PhotoCollections() {
  const { data: collections = [], isLoading, refetch } = usePhotoCollections();
  const { mutate: createCollection, isPending: isCreating } = useCreatePhotoCollection();
  const { mutate: deleteCollection } = useDeletePhotoCollection();
  const { mutate: renameCollection } = useRenamePhotoCollection();
  const [selected, setSelected] = useState<PhotoCollection | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  function handleCreate() {
    if (!newName.trim()) return;
    createCollection(
      { name: newName.trim(), description: newDesc.trim() || undefined },
      {
        onSuccess: () => {
          setNewName("");
          setNewDesc("");
          setShowCreate(false);
        },
      }
    );
  }

  function startRename(col: PhotoCollection) {
    setRenamingId(col.id);
    setRenameValue(col.name);
  }

  function commitRename(id: number) {
    if (renameValue.trim()) {
      renameCollection({ id, name: renameValue.trim() });
    }
    setRenamingId(null);
  }

  if (selected) {
    return <CollectionDetail collection={selected} onBack={() => { setSelected(null); refetch(); }} />;
  }

  return (
    <div className="overflow-y-auto h-full px-4 sm:px-10 py-4 sm:py-6">
      {/* Header actions */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-[#5a5244] text-xs font-mono">
          {collections.length} collection{collections.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => { setShowCreate(true); setTimeout(() => createInputRef.current?.focus(), 50); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)] text-xs font-mono transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Collection
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-5"
          >
            <div className="bg-[#1a1814] border border-white/10 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-[#c8bfa8] text-sm font-medium">New Collection</p>
              <input
                ref={createInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
                placeholder="Collection name…"
                className="bg-[#2a2820] border border-white/7 rounded-lg px-3 py-2 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)…"
                className="bg-[#2a2820] border border-white/7 rounded-lg px-3 py-2 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || isCreating}
                  className="px-4 py-1.5 rounded-lg bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)] text-xs font-mono transition-colors disabled:opacity-40"
                >
                  {isCreating ? "Creating…" : "Create"}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }}
                  className="px-4 py-1.5 rounded-lg bg-[#2a2820] text-[#5a5244] hover:text-[#c8bfa8] text-xs font-mono transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex justify-center pt-12">
          <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <p className="text-[#5a5244] text-sm">No collections yet</p>
          <p className="text-[#3a3628] text-xs text-center max-w-xs">
            Create collections to group photos by theme, trip, or event — independent of how they're stored on disk.
          </p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <AnimatePresence>
            {collections.map((col) => (
              <motion.div
                key={col.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                className="group relative rounded-xl overflow-hidden border border-white/8 bg-[#131210] cursor-pointer hover:border-[var(--accent)]/30 transition-colors"
                onClick={() => setSelected(col)}
              >
                {/* Cover */}
                <div className="h-36 bg-[#1a1814] overflow-hidden">
                  {col.cover_path ? (
                    <img
                      src={getImgSrc(col.cover_path)}
                      alt={col.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#2a2820]">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  {renamingId === col.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitRename(col.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => commitRename(col.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-[#2a2820] border border-[var(--accent)]/40 rounded px-2 py-0.5 text-sm text-[#f0ead8] outline-none"
                    />
                  ) : (
                    <p className="text-[#f0ead8] text-sm font-medium truncate">{col.name}</p>
                  )}
                  {col.description && (
                    <p className="text-[#5a5244] text-xs truncate mt-0.5">{col.description}</p>
                  )}
                  <p className="text-[#3a3628] text-xs font-mono mt-1">
                    {col.count} photo{col.count !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Actions (appear on hover) */}
                <div
                  className="absolute top-2 right-2 hidden group-hover:flex gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(col); }}
                    className="w-7 h-7 rounded-lg bg-black/70 text-white/70 hover:text-white hover:bg-black/90 flex items-center justify-center transition-colors"
                    title="Rename"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete collection "${col.name}"? Photos will not be deleted.`)) {
                        deleteCollection({ id: col.id });
                      }
                    }}
                    className="w-7 h-7 rounded-lg bg-black/70 text-white/70 hover:text-red-400 hover:bg-black/90 flex items-center justify-center transition-colors"
                    title="Delete collection"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
