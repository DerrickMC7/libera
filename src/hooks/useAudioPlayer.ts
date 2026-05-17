import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../store/playerStore";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const { currentTrack, isPlaying, volume } = usePlayerStore();

  useEffect(() => {
    audioRef.current = new Audio();

    audioRef.current.addEventListener("timeupdate", () => {
      if (audioRef.current) setProgress(audioRef.current.currentTime);
    });

    audioRef.current.addEventListener("loadedmetadata", () => {
      if (audioRef.current) setDuration(audioRef.current.duration || 0);
    });

    audioRef.current.addEventListener("ended", () => {
      const { repeat } = usePlayerStore.getState();
      if (repeat === "one" && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(console.error);
      } else {
        usePlayerStore.getState().nextTrack();
      }
    });

    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;
    audioRef.current.src = convertFileSrc(currentTrack.path);
  }, [currentTrack]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(console.error);
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  function seek(time: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setProgress(time);
  }

  return { progress, duration, seek, audioRef };
}

