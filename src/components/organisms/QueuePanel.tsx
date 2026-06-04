import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePlayerStore } from "../../store/playerStore";
import { useArtwork } from "../../hooks/useArtwork";

const AUTO_LIMIT    = 60;   // max upcoming auto-loaded tracks shown
const MANUAL_LIMIT  = 100;  // max upcoming user-added tracks shown
const HISTORY_LIMIT = 20;   // max past tracks shown when history is revealed

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function QueueTrack({
  path, title, artist, duration, isActive, isPast, isManual, scrollToMe, onClick,
}: {
  path: string; title: string; artist: string; duration: number;
  isActive: boolean; isPast: boolean; isManual: boolean;
  scrollToMe: boolean; onClick: () => void;
}) {
  const { data: art } = useArtwork(path);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (scrollToMe) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollToMe]);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-colors ${
        isActive ? "bg-[var(--accent-a08)]" : "hover:bg-[#1f1d18]"
      } ${isPast ? "opacity-40" : ""}`}
    >
      <div className="w-8 h-8 rounded shrink-0 overflow-hidden bg-[#2a2820]">
        {art ? (
          <img src={art} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-xs truncate ${isActive ? "text-[var(--accent)]" : "text-[#f0ead8]"}`}>{title}</p>
        <p className="text-[11px] text-[#7a7060] truncate">{artist}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isManual && !isPast && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-70" title="Added by you" />
        )}
        <span className="text-[11px] font-mono text-[#3a3628]">{formatDuration(duration)}</span>
      </div>
    </button>
  );
}

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const { queue, shuffledQueue, queueIndex, shuffle, setQueue, setIsPlaying, manualQueuePaths } = usePlayerStore();
  const activeQueue = shuffle ? shuffledQueue : queue;
  const [showHistory, setShowHistory] = useState(false);

  // Build a set for fast manual-track lookup (handles duplicates by presence only)
  const manualSet = new Set(manualQueuePaths);

  // ─── Past tracks (behind current index) ──────────────────────────────────
  const allPast  = activeQueue.slice(0, queueIndex);
  const pastTracks = allPast.slice(-HISTORY_LIMIT); // most recent HISTORY_LIMIT
  const hiddenPastCount = allPast.length - pastTracks.length;

  // ─── Current track ────────────────────────────────────────────────────────
  const currentTrackInQueue = activeQueue[queueIndex];

  // ─── Upcoming tracks with limits ─────────────────────────────────────────
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

  function handleClickTrack(absIdx: number) {
    setQueue(queue, absIdx);
    setIsPlaying(true);
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
                {/* History toggle */}
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
                      onClick={() => {}}
                    />
                  )}

                  {/* Upcoming tracks */}
                  {futureTracks.length > 0 && (
                    <div className="mx-4 my-2 border-t border-white/5" />
                  )}
                  {futureTracks.map(({ track, absIdx, isManual }) => (
                    <QueueTrack
                      key={`future-${track.path}-${absIdx}`}
                      path={track.path}
                      title={track.title}
                      artist={track.artist}
                      duration={track.duration_secs}
                      isActive={false}
                      isPast={false}
                      isManual={isManual}
                      scrollToMe={false}
                      onClick={() => handleClickTrack(absIdx)}
                    />
                  ))}

                  {/* "More songs" notice */}
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
