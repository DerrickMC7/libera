import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { usePlayerStore } from "../../store/playerStore";
import { PlayButton } from "../atoms/PlayButton";
import { SkipButton } from "../atoms/SkipButton";
import { ProgressBar } from "../atoms/ProgressBar";
import { VolumeSlider } from "../atoms/VolumeSlider";

export function AudioPlayer() {
  const { progress, duration, seek } = useAudioPlayer();
  const {
    currentTrack,
    isPlaying,
    volume,
    setIsPlaying,
    setVolume,
    nextTrack,
    previousTrack,
  } = usePlayerStore();

  if (!currentTrack) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#161410] border-t border-white/5 flex items-center px-6 gap-6 z-50">
      {/* Track info */}
      <div className="flex flex-col min-w-0 w-56">
        <p className="text-sm text-[#f0ead8] truncate">{currentTrack.title}</p>
        <p className="text-xs text-[#7a7060] truncate">{currentTrack.artist}</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center flex-1 gap-2">
        <div className="flex items-center gap-6">
          <SkipButton direction="previous" onClick={previousTrack} />
          <PlayButton isPlaying={isPlaying} onClick={() => setIsPlaying(!isPlaying)} />
          <SkipButton direction="next" onClick={nextTrack} />
        </div>
        <ProgressBar progress={progress} duration={duration} onSeek={seek} />
      </div>

      {/* Volume */}
      <VolumeSlider volume={volume} onVolumeChange={setVolume} />
    </div>
  );
}