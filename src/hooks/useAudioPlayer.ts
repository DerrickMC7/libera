import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../store/playerStore";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const { currentTrack, isPlaying, volume, setIsPlaying, nextTrack } =
    usePlayerStore();

  // Create audio element once
  useEffect(() => {
    audioRef.current = new Audio();

    audioRef.current.addEventListener("timeupdate", () => {
      if (audioRef.current) {
        setProgress(audioRef.current.currentTime);
      }
    });

    audioRef.current.addEventListener("loadedmetadata", () => {
      if (audioRef.current) {
        setDuration(audioRef.current.duration);
      }
    });

    audioRef.current.addEventListener("ended", () => {
  const { repeat, nextTrack } = usePlayerStore.getState();
  if (repeat === "one" && audioRef.current) {
    audioRef.current.currentTime = 0;
    audioRef.current.play();
  } else {
    nextTrack();
  }
});

    return () => {
      audioRef.current?.pause();
    };
  }, []);

  // Load new track when currentTrack changes
  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;
    // convertFileSrc converts a local file path to a URL the webview can load
    const url = convertFileSrc(currentTrack.path);
    audioRef.current.src = url;
    audioRef.current.load();
    if (isPlaying) {
      audioRef.current.play();
    }
  }, [currentTrack]);

  // Handle play/pause
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Handle volume
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  function seek(time: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setProgress(time);
  }

  return { progress, duration, seek };
}