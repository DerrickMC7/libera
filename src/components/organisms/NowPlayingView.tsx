import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePlayerStore } from "../../store/playerStore";
import { useArtworkOriginal } from "../../hooks/useArtworkOriginal";
import { useArtwork } from "../../hooks/useArtwork";
import { PlayButton } from "../atoms/PlayButton";
import { SkipButton } from "../atoms/SkipButton";
import { ShuffleButton } from "../atoms/ShuffleButton";
import { RepeatButton } from "../atoms/RepeatButton";
import { ProgressBar } from "../atoms/ProgressBar";
import { VolumeSlider } from "../atoms/VolumeSlider";

interface NowPlayingViewProps {
  open: boolean;
  onClose: () => void;
  progress: number;
  duration: number;
  seek: (time: number) => void;
}

export function NowPlayingView({ open, onClose, progress, duration, seek }: NowPlayingViewProps) {
  const {
    currentTrack, isPlaying, volume, isMuted, shuffle, repeat,
    setIsPlaying, setVolume, toggleMute, nextTrack, previousTrack,
    toggleShuffle, toggleRepeat,
  } = usePlayerStore();
  // Use original-resolution artwork (up to 1200px); fall back to the 300px "full" tier
  // while the original is still being extracted and cached on first open.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        (document.activeElement as HTMLElement)?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const { data: originalUrl } = useArtworkOriginal(currentTrack?.path, true);
  const { data: fallbackUrl } = useArtwork(currentTrack?.path, true, true);
  const artworkUrl = originalUrl ?? fallbackUrl;

  if (!currentTrack) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={onClose}
        >
          {/* Blurred backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" />

          {/* Card */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-[420px] bg-[#161410] rounded-2xl shadow-2xl border border-white/8 overflow-hidden"
          >
            {/* Album art */}
            <div className="relative w-full aspect-square">
              {artworkUrl ? (
                <img src={artworkUrl} alt={currentTrack.album} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#1f1d18] flex items-center justify-center">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
              )}
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>

            {/* Info + controls */}
            <div className="px-7 pt-5 pb-7">
              {/* Track info */}
              <div className="mb-5">
                <p className="text-lg text-[#faf8f2] font-light truncate" style={{ fontFamily: "Fraunces, serif" }}>
                  {currentTrack.title}
                </p>
                <p className="text-sm text-[#7a7060] truncate mt-0.5">{currentTrack.artist}</p>
                <p className="text-xs text-[#3a3628] font-mono truncate mt-0.5">{currentTrack.album}</p>
              </div>

              {/* Progress */}
              <div className="mb-5">
                <ProgressBar progress={progress} duration={duration} onSeek={seek} />
              </div>

              {/* Playback controls */}
              <div className="flex items-center justify-center gap-6 mb-6">
                <ShuffleButton active={shuffle} onClick={toggleShuffle} />
                <SkipButton direction="previous" onClick={previousTrack} />
                <PlayButton isPlaying={isPlaying} onClick={() => setIsPlaying(!isPlaying)} />
                <SkipButton direction="next" onClick={nextTrack} />
                <RepeatButton mode={repeat} onClick={toggleRepeat} />
              </div>

              {/* Volume */}
              <div className="flex justify-center">
                <VolumeSlider volume={volume} isMuted={isMuted} onVolumeChange={setVolume} onToggleMute={toggleMute} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
