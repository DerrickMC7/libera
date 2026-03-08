import { create } from "zustand";
import { Track } from "../types/track";

interface PlayerState {
  // Current track being played
  currentTrack: Track | null;
  // Player status
  isPlaying: boolean;
  volume: number;
  // Queue
  queue: Track[];
  queueIndex: number;
  // Actions
  setCurrentTrack: (track: Track) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setQueue: (tracks: Track[], startIndex: number) => void;
  nextTrack: () => void;
  previousTrack: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  volume: 1,
  queue: [],
  queueIndex: 0,

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),

  setQueue: (tracks, startIndex) =>
    set({
      queue: tracks,
      queueIndex: startIndex,
      currentTrack: tracks[startIndex] ?? null,
    }),

  nextTrack: () => {
    const { queue, queueIndex } = get();
    const nextIndex = queueIndex + 1;
    if (nextIndex < queue.length) {
      set({ queueIndex: nextIndex, currentTrack: queue[nextIndex] });
    }
  },

  previousTrack: () => {
    const { queue, queueIndex } = get();
    const prevIndex = queueIndex - 1;
    if (prevIndex >= 0) {
      set({ queueIndex: prevIndex, currentTrack: queue[prevIndex] });
    }
  },
}));