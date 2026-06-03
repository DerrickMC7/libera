import { useState, useRef, useEffect } from "react";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { usePlayerStore } from "../../store/playerStore";
import { PlayButton } from "../atoms/PlayButton";
import { SkipButton } from "../atoms/SkipButton";
import { ProgressBar } from "../atoms/ProgressBar";
import { VolumeSlider } from "../atoms/VolumeSlider";
import { ShuffleButton } from "../atoms/ShuffleButton";
import { RepeatButton } from "../atoms/RepeatButton";
import { useArtwork } from "../../hooks/useArtwork";
import { Equalizer } from "./Equalizer";

export function AudioPlayer() {
  const { progress, duration, seek } = useAudioPlayer();
  const {
    currentTrack, isPlaying, volume, shuffle, repeat,
    setIsPlaying, setVolume, nextTrack, previousTrack,
    toggleShuffle, toggleRepeat,
  } = usePlayerStore();

  const { data: artworkUrl } = useArtwork(currentTrack?.path);
  const [eqOpen, setEqOpen] = useState(false);
  const eqRef = useRef<HTMLDivElement>(null);

  // Close EQ popup on outside click
  useEffect(() => {
    if (!eqOpen) return;
    function handleClick(e: MouseEvent) {
      if (eqRef.current && !eqRef.current.contains(e.target as Node)) {
        setEqOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [eqOpen]);

  if (!currentTrack) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#161410] border-t border-white/5 flex items-center px-6 gap-6 z-50">
      {/* Track info */}
      <div className="flex items-center gap-3 min-w-0 w-56">
        <div className="w-10 h-10 rounded-md bg-[#2a2820] shrink-0 overflow-hidden">
          {artworkUrl ? (
            <img src={artworkUrl} alt={currentTrack.album} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>
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

      {/* Volume + EQ */}
      <div className="flex items-center gap-2 relative" ref={eqRef}>
        <VolumeSlider volume={volume} onVolumeChange={setVolume} />

        {/* EQ button */}
        <button
          onClick={() => setEqOpen((v) => !v)}
          title="Equalizer"
          className={`p-1.5 rounded-md transition-colors ${
            eqOpen ? "text-[#d4872a] bg-[#d4872a]/10" : "text-[#3a3628] hover:text-[#7a7060]"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 20v-6.586l-4.707-4.707A1 1 0 015 8V4h14v4a1 1 0 01-.293.707L14 13.414V17l-4 3z" />
            <path d="M7 4v3.586l4.707 4.707A1 1 0 0112 13v5l1.5-1.125V13a1 1 0 01.293-.707L18 7.586V4H7z" />
          </svg>
        </button>

        {/* EQ popup */}
        {eqOpen && (
          <div className="absolute bottom-12 right-0 z-50 shadow-2xl">
            <Equalizer compact onClose={() => setEqOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}