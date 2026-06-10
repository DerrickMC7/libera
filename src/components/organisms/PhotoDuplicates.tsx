import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Photo } from "../../types/photo";
import { useFindDuplicatePhotos, useDeletePhotoFromLibrary } from "../../hooks/usePhotos";
import { usePhotoStore } from "../../store/photoStore";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getImgSrc(p: Photo): string {
  return IS_DEMO ? p.path : convertFileSrc(p.path);
}

export function PhotoDuplicates() {
  const { data: groups = [], isLoading, refetch } = useFindDuplicatePhotos();
  const { mutate: deletePhoto } = useDeletePhotoFromLibrary();
  const { openLightbox } = usePhotoStore();
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set());

  const visibleGroups = groups.filter((_, i) => !dismissed.has(i));
  const totalDupes = visibleGroups.reduce((s, g) => s + g.length - 1, 0);
  const wastedSpace = visibleGroups.reduce((s, g) => s + g[0].file_size * (g.length - 1), 0);

  function handleDelete(path: string) {
    setDeletedPaths((prev) => new Set([...prev, path]));
    deletePhoto({ path });
  }

  function handleDismiss(idx: number) {
    setDismissed((prev) => new Set([...prev, idx]));
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (visibleGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
          <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-[#7a7060] text-base">No duplicates found</p>
        <p className="text-[#3a3628] text-xs max-w-xs">
          Photos are matched by filename and file size. If you've recently added photos, click Rescan.
        </p>
        <button
          onClick={() => { setDismissed(new Set()); refetch(); }}
          className="px-4 py-2 rounded-lg bg-[var(--accent-a10)] text-[var(--accent)] text-xs font-mono hover:bg-[var(--accent-a20)] transition-colors"
        >
          Rescan
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full px-10 py-6">
      {/* Summary banner */}
      <div className="mb-6 flex items-center gap-4 p-4 rounded-xl bg-[#1a1814] border border-white/8">
        <div className="flex-1">
          <p className="text-[#f0ead8] text-sm font-medium">
            {visibleGroups.length} duplicate group{visibleGroups.length !== 1 ? "s" : ""} found
          </p>
          <p className="text-[#5a5244] text-xs mt-0.5">
            {totalDupes} extra cop{totalDupes !== 1 ? "ies" : "y"} · {formatBytes(wastedSpace)} wasted space
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!IS_DEMO && (
            <button
              onClick={() => {
                if (!window.confirm(`Remove ${totalDupes} duplicate copies? Originals (first found) will be kept.`)) return;
                for (const group of visibleGroups) {
                  const duplicates = group.filter((_, i) => i > 0);
                  for (const p of duplicates) {
                    if (!deletedPaths.has(p.path)) handleDelete(p.path);
                  }
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-mono transition-colors"
            >
              Remove all duplicates
            </button>
          )}
          <button
            onClick={() => { setDismissed(new Set()); refetch(); }}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-[#5a5244] hover:text-[var(--accent)] text-xs font-mono transition-colors"
          >
            Rescan
          </button>
        </div>
      </div>

      {/* Duplicate groups */}
      <AnimatePresence>
        {visibleGroups.map((group, gi) => {
          const actualIdx = groups.indexOf(group);
          const activePhotos = group.filter((p) => !deletedPaths.has(p.path));
          if (activePhotos.length <= 1) return null;
          return (
            <motion.div
              key={`group-${gi}`}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-4 rounded-xl border border-white/8 bg-[#131210] overflow-hidden"
            >
              {/* Group header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a5244" strokeWidth="1.5">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  <span className="text-[#c8bfa8] text-sm font-medium">{group[0].name}</span>
                  <span className="text-[#5a5244] text-xs font-mono">
                    {activePhotos.length} copies · {formatBytes(group[0].file_size)} each
                  </span>
                </div>
                <button
                  onClick={() => handleDismiss(actualIdx)}
                  className="text-[#3a3628] hover:text-[#7a7060] transition-colors text-xs font-mono"
                >
                  Dismiss
                </button>
              </div>

              {/* Photos in group */}
              <div className="flex gap-3 p-4 overflow-x-auto">
                {group.map((photo, pi) => {
                  const isDeleted = deletedPaths.has(photo.path);
                  return (
                    <motion.div
                      key={photo.path}
                      layout
                      animate={{ opacity: isDeleted ? 0.3 : 1 }}
                      className="shrink-0 flex flex-col gap-2"
                      style={{ width: 160 }}
                    >
                      {/* Thumbnail */}
                      <button
                        onClick={() => openLightbox(activePhotos, Math.min(pi, activePhotos.length - 1))}
                        className="relative rounded-lg overflow-hidden bg-[#1a1814] group"
                        style={{ height: 120 }}
                        disabled={isDeleted}
                      >
                        <img
                          src={getImgSrc(photo)}
                          alt={photo.name}
                          className="w-full h-full object-cover"
                        />
                        {pi === 0 && !isDeleted && (
                          <div className="absolute top-1.5 left-1.5 bg-[var(--accent)] text-black text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider">
                            Original
                          </div>
                        )}
                        {isDeleted && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="text-white/60 text-xs font-mono">Removed</span>
                          </div>
                        )}
                      </button>

                      {/* Info */}
                      <div className="px-0.5">
                        <p className="text-[#5a5244] text-[10px] font-mono truncate" title={photo.folder}>
                          {photo.folder.split(/[/\\]/).pop()}
                        </p>
                        <p className="text-[#3a3628] text-[10px] font-mono">{formatDate(photo.date_modified)}</p>
                      </div>

                      {/* Action */}
                      {!isDeleted && (
                        <div className="flex flex-col gap-1">
                          {pi > 0 && (
                            <button
                              onClick={() => handleDelete(photo.path)}
                              className="flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-mono"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                              </svg>
                              Remove
                            </button>
                          )}
                          {!IS_DEMO && activePhotos.length > 1 && (
                            <button
                              onClick={() => {
                                const others = group.filter((p) => p.path !== photo.path && !deletedPaths.has(p.path));
                                others.forEach((p) => handleDelete(p.path));
                              }}
                              className="flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--accent-a10)] text-[var(--accent)] hover:bg-[var(--accent-a20)] transition-colors text-xs font-mono"
                              title="Keep only this copy, remove the rest"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                              Keep this
                            </button>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
