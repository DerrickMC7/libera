import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePlayerStore } from "../../store/playerStore";
import { useArtwork } from "../../hooks/useArtwork";
import { useContextMenuStore } from "../../store/contextMenuStore";
import { Track } from "../../types/track";

const AUTO_LIMIT    = 60;
const MANUAL_LIMIT  = 100;
const HISTORY_LIMIT = 20;

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function QueueTrack({
  path, title, artist, duration, isActive, isPast, isManual, scrollToMe, onClick,
  track, onRemove, onDragStart, onDragOver, onDrop, onDragEnd, isDragging, isDragOver,
}: {
  path: string; title: string; artist: string; duration: number;
  isActive: boolean; isPast: boolean; isManual: boolean;
  scrollToMe: boolean; onClick: () => void;
  track?: Track;
  onRemove?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}) {
  const { data: art } = useArtwork(path, false, true);
  const rowRef = useRef<HTMLDivElement>(null);
  const showContextMenu = useContextMenuStore((s) => s.show);

  useEffect(() => {
    if (scrollToMe) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollToMe]);

  const isDraggable = !!onDragStart;

  return (
    <div
      ref={rowRef}
      draggable={isDraggable}
      onDragStart={isDraggable ? (e) => {
        e.dataTransfer.setData("text/plain", "");
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(e);
      } : undefined}
      onDragEnter={(e) => e.preventDefault()}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver?.(e); }}
      onDrop={(e) => { e.preventDefault(); onDrop?.(e); }}
      onDragEnd={onDragEnd}
      onContextMenu={track ? (e) => { e.preventDefault(); showContextMenu(track, e.clientX, e.clientY); } : undefined}
      className={`group relative w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-all
        ${isActive ? "bg-[var(--accent-a08)]" : "hover:bg-[#1f1d18]"}
        ${isPast ? "opacity-40" : ""}
        ${isDragging ? "opacity-20" : ""}
        ${isDragOver ? "outline outline-1 outline-[var(--accent-a30)] bg-[var(--accent-a08)]" : ""}
      `}
    >
      {/* Drag handle — visual only, draggable is on the row */}
      <div
        className={`shrink-0 transition-colors select-none pointer-events-none ${
          isDraggable
            ? "text-[#2a2820] group-hover:text-[#5a5448]"
            : "w-2.5"
        }`}
      >
        {isDraggable && (
          <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="3" cy="2" r="1.5" />
            <circle cx="7" cy="2" r="1.5" />
            <circle cx="3" cy="6" r="1.5" />
            <circle cx="7" cy="6" r="1.5" />
            <circle cx="3" cy="10" r="1.5" />
            <circle cx="7" cy="10" r="1.5" />
          </svg>
        )}
      </div>

      {/* Artwork */}
      <div className="w-8 h-8 rounded shrink-0 overflow-hidden bg-[#2a2820]">
        {art ? (
          <img src={art} alt="" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Track info — click to play */}
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <p className={`text-xs truncate ${isActive ? "text-[var(--accent)]" : "text-[#f0ead8]"}`}>{title}</p>
        <p className="text-[11px] text-[#7a7060] truncate">{artist}</p>
      </button>

      {/* Right side: badge + duration + delete */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isManual && !isPast && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-70" title="Added by you" />
        )}
        <span className="text-[11px] font-mono text-[#3a3628]">{formatDuration(duration)}</span>
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove from queue"
            className="opacity-0 group-hover:opacity-100 p-0.5 text-[#3a3628] hover:text-[#c85858] transition-all"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const {
    queue, shuffledQueue, queueIndex, shuffle, jumpToTrack, playFromQueue, setIsPlaying,
    manualQueuePaths, removeFromQueue, reorderQueue,
  } = usePlayerStore();
  const activeQueue = shuffle ? shuffledQueue : queue;
  const [showHistory, setShowHistory] = useState(false);
  const [localFutureTracks, setLocalFutureTracks] = useState<typeof futureTracks>([]);
  const [dragLocalIdx, setDragLocalIdx] = useState<number | null>(null);
  const dragSrcAbsIdxRef = useRef<number | null>(null);
  const dropFiredRef = useRef(false);

  const manualSet = new Set(manualQueuePaths);

  // ─── Past tracks ──────────────────────────────────────────────────────────
  const allPast  = activeQueue.slice(0, queueIndex);
  const pastTracks = allPast.slice(-HISTORY_LIMIT);
  const hiddenPastCount = allPast.length - pastTracks.length;

  // ─── Current track ────────────────────────────────────────────────────────
  const currentTrackInQueue = activeQueue[queueIndex];

  // ─── Upcoming tracks ──────────────────────────────────────────────────────
  const allFuture = activeQueue.slice(queueIndex + 1);
  let autoShown = 0, manualShown = 0;
  const futureTracks: { track: typeof allFuture[0]; absIdx: number; isManual: boolean }[] = [];

  for (let i = 0; i < allFuture.length; i++) {
    const track = allFuture[i];
    const isManual = manualSet.has(track.path);
    if (isManual) {
      if (manualShown >= MANUAL_LIMIT) continue;
      manualShown++;
    } else {
      if (autoShown >= AUTO_LIMIT) continue;
      autoShown++;
    }
    futureTracks.push({ track, absIdx: queueIndex + 1 + i, isManual });
  }

  const hiddenFutureCount = allFuture.length - futureTracks.length;

  // Sync local list when queue changes (but not mid-drag)
  useEffect(() => {
    if (dragLocalIdx === null) setLocalFutureTracks(futureTracks);
  }, [activeQueue, queueIndex]);

  function handleClickTrack(absIdx: number) {
    if (absIdx > queueIndex) {
      playFromQueue(absIdx);
    } else {
      jumpToTrack(absIdx);
    }
    setIsPlaying(true);
  }

  function handleDragStart(localIdx: number, absIdx: number) {
    dropFiredRef.current = false;
    dragSrcAbsIdxRef.current = absIdx;
    setDragLocalIdx(localIdx);
  }

  function handleDragOver(localIdx: number) {
    if (dragLocalIdx === null || dragLocalIdx === localIdx) return;
    const next = [...localFutureTracks];
    const [moved] = next.splice(dragLocalIdx, 1);
    next.splice(localIdx, 0, moved);
    setLocalFutureTracks(next);
    setDragLocalIdx(localIdx);
  }

  function handleDrop() {
    dropFiredRef.current = true;
    const srcAbsIdx = dragSrcAbsIdxRef.current;
    const finalLocalIdx = dragLocalIdx;
    setDragLocalIdx(null);
    dragSrcAbsIdxRef.current = null;
    if (srcAbsIdx === null || finalLocalIdx === null) return;
    // Compute target absIdx from the item immediately after the dropped position.
    // reorderQueue(from, to) inserts before `to` when moving up, and before `to-1` when moving down,
    // so passing the next item's absIdx correctly places the dragged item after its new neighbour.
    const nextItem = localFutureTracks[finalLocalIdx + 1];
    const prevItem = localFutureTracks[finalLocalIdx - 1];
    const toAbsIdx = nextItem ? nextItem.absIdx : prevItem ? prevItem.absIdx + 1 : srcAbsIdx;
    reorderQueue(srcAbsIdx, toAbsIdx);
  }

  function handleDragEnd() {
    if (!dropFiredRef.current) {
      // Drag was cancelled — reset visual state back to store order
      setLocalFutureTracks(futureTracks);
    }
    dropFiredRef.current = false;
    setDragLocalIdx(null);
    dragSrcAbsIdxRef.current = null;
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
            className="fixed right-0 top-0 bottom-20 w-80 bg-[#161410] border-l border-white/5 z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
              <div>
                <p className="text-xs font-mono tracking-widest uppercase text-[var(--accent)]">Queue</p>
                <p className="text-[11px] text-[#3a3628] font-mono mt-0.5">
                  {futureTracks.length} upcoming
                  {manualQueuePaths.length > 0 && (
                    <span className="text-[var(--accent)]"> · {manualQueuePaths.length} added by you</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {queueIndex > 0 && (
                  <button
                    onClick={() => setShowHistory((v) => !v)}
                    title={showHistory ? "Hide played" : "Show played"}
                    className={`p-1.5 rounded-md transition-colors text-xs font-mono ${
                      showHistory
                        ? "text-[var(--accent)] bg-[var(--accent-a10)]"
                        : "text-[#3a3628] hover:text-[#7a7060]"
                    }`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
                    </svg>
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors p-1"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H19v-2z"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Track list */}
            <div className="flex-1 overflow-y-auto py-2 px-1">
              {activeQueue.length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-[#3a3628] text-xs font-mono">Nothing in queue</p>
                </div>
              ) : (
                <>
                  {/* History section */}
                  <AnimatePresence>
                    {showHistory && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        {hiddenPastCount > 0 && (
                          <p className="text-center text-[10px] font-mono text-[#3a3628] py-2">
                            + {hiddenPastCount} earlier songs
                          </p>
                        )}
                        {pastTracks.map((track, i) => {
                          const absIdx = queueIndex - pastTracks.length + i;
                          return (
                            <QueueTrack
                              key={`past-${track.path}-${absIdx}`}
                              path={track.path}
                              title={track.title}
                              artist={track.artist}
                              duration={track.duration_secs}
                              isActive={false}
                              isPast={true}
                              isManual={false}
                              scrollToMe={false}
                              onClick={() => handleClickTrack(absIdx)}
                            />
                          );
                        })}
                        <div className="mx-4 my-2 border-t border-white/5" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Current track */}
                  {currentTrackInQueue && (
                    <QueueTrack
                      key={`current-${currentTrackInQueue.path}`}
                      path={currentTrackInQueue.path}
                      title={currentTrackInQueue.title}
                      artist={currentTrackInQueue.artist}
                      duration={currentTrackInQueue.duration_secs}
                      isActive={true}
                      isPast={false}
                      isManual={manualSet.has(currentTrackInQueue.path)}
                      scrollToMe={true}
                      track={currentTrackInQueue}
                      onClick={() => {}}
                    />
                  )}

                  {/* Upcoming tracks */}
                  {futureTracks.length > 0 && (
                    <div className="mx-4 my-2 border-t border-white/5" />
                  )}
                  {localFutureTracks.map(({ track, absIdx, isManual }, localIdx) => (
                    <motion.div key={track.path} layout transition={{ duration: 0.18 }}>
                      <QueueTrack
                        path={track.path}
                        title={track.title}
                        artist={track.artist}
                        duration={track.duration_secs}
                        isActive={false}
                        isPast={false}
                        isManual={isManual}
                        scrollToMe={false}
                        track={track}
                        onClick={() => handleClickTrack(absIdx)}
                        onRemove={() => removeFromQueue(absIdx)}
                        onDragStart={() => handleDragStart(localIdx, absIdx)}
                        onDragOver={() => handleDragOver(localIdx)}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        isDragging={dragLocalIdx === localIdx}
                        isDragOver={false}
                      />
                    </motion.div>
                  ))}

                  {hiddenFutureCount > 0 && (
                    <p className="text-center text-[10px] font-mono text-[#3a3628] py-3">
                      + {hiddenFutureCount} more in queue
                    </p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
