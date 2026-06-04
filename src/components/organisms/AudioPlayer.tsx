import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { usePlayerStore } from "../../store/playerStore";
import { useToastStore } from "../../store/toastStore";
import { PlayButton } from "../atoms/PlayButton";
import { SkipButton } from "../atoms/SkipButton";
import { ProgressBar } from "../atoms/ProgressBar";
import { VolumeSlider } from "../atoms/VolumeSlider";
import { ShuffleButton } from "../atoms/ShuffleButton";
import { RepeatButton } from "../atoms/RepeatButton";
import { useArtwork } from "../../hooks/useArtwork";
import { Equalizer } from "./Equalizer";
import { QueuePanel } from "./QueuePanel";
import { NowPlayingView } from "./NowPlayingView";

export function AudioPlayer() {
  const { progress, duration, seek } = useAudioPlayer();
  const {
    currentTrack, isPlaying, volume, shuffle, repeat, manualQueuePaths,
    setIsPlaying, setVolume, nextTrack, previousTrack,
    toggleShuffle, toggleRepeat,
  } = usePlayerStore();
  const { message: toastMessage, visible: toastVisible } = useToastStore();

  const { data: artworkUrl } = useArtwork(currentTrack?.path);
  const [eqOpen, setEqOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const eqRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!eqOpen) return;
    function handleClick(e: MouseEvent) {
      if (eqRef.current && !eqRef.current.contains(e.target as Node)) setEqOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [eqOpen]);

  if (!currentTrack) return null;

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#161410] border-t border-white/5 flex items-center px-6 gap-6 z-50">
        {/* Track info — click art to open Now Playing */}
        <div className="flex items-center gap-3 min-w-0 w-56">
          <button
            onClick={() => setNowPlayingOpen(true)}
            className="w-10 h-10 rounded-md bg-[#2a2820] shrink-0 overflow-hidden hover:opacity-80 transition-opacity"
          >
            {artworkUrl ? (
              <img src={artworkUrl} alt={currentTrack.album} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </button>
          <div className="min-w-0">
            <p className="text-sm text-[#f0ead8] truncate">{currentTrack.title}</p>
            <p className="text-xs text-[#7a7060] truncate">{currentTrack.artist}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center flex-1 gap-2">
          <div className="flex items-center gap-5">
            <ShuffleButton active={shuffle} onClick={toggleShuffle} />
            <SkipButton direction="previous" onClick={previousTrack} />
            <PlayButton isPlaying={isPlaying} onClick={() => setIsPlaying(!isPlaying)} />
            <SkipButton direction="next" onClick={nextTrack} />
            <RepeatButton mode={repeat} onClick={toggleRepeat} />
          </div>
          <ProgressBar progress={progress} duration={duration} onSeek={seek} />
        </div>

        {/* Volume + EQ + Queue */}
        <div className="flex items-center gap-2 relative" ref={eqRef}>
          <VolumeSlider volume={volume} onVolumeChange={setVolume} />

          {/* EQ button */}
          <button
            onClick={() => setEqOpen((v) => !v)}
            title="Equalizer"
            className={`p-1.5 rounded-md transition-colors ${
              eqOpen ? "text-[var(--accent)] bg-[var(--accent-a10)]" : "text-[#3a3628] hover:text-[#7a7060]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 20v-6.586l-4.707-4.707A1 1 0 015 8V4h14v4a1 1 0 01-.293.707L14 13.414V17l-4 3z" />
              <path d="M7 4v3.586l4.707 4.707A1 1 0 0112 13v5l1.5-1.125V13a1 1 0 01.293-.707L18 7.586V4H7z" />
            </svg>
          </button>

          {/* Queue button */}
          <button
            onClick={() => setQueueOpen((v) => !v)}
            title="Queue"
            className={`relative p-1.5 rounded-md transition-colors ${
              queueOpen ? "text-[var(--accent)] bg-[var(--accent-a10)]" : "text-[#3a3628] hover:text-[#7a7060]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
            </svg>
            {manualQueuePaths.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--accent)] text-white text-[8px] font-mono flex items-center justify-center">
                {Math.min(manualQueuePaths.length, 99)}
              </span>
            )}
          </button>

          {/* EQ popup */}
          {eqOpen && (
            <div className="absolute bottom-12 right-0 z-50 shadow-2xl">
              <Equalizer compact onClose={() => setEqOpen(false)} />
            </div>
          )}
        </div>
      </div>

      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
      <NowPlayingView
        open={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        progress={progress}
        duration={duration}
        seek={seek}
      />

      {/* Queue action toast */}
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            key="queue-toast"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{    opacity: 0, y: 6,  scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#2a2820] border border-white/8 shadow-xl pointer-events-none"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--accent)] shrink-0">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
            <span className="text-xs font-mono text-[#c8bfa8] whitespace-nowrap">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
