import { create } from "zustand";
import { Track } from "../types/track";

type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  queue: Track[];
  queueIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  shuffledQueue: Track[];
  // Actions
  setCurrentTrack: (track: Track) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setQueue: (tracks: Track[], startIndex: number) => void;
  nextTrack: () => void;
  previousTrack: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  volume: 1,
  queue: [],
  queueIndex: 0,
  shuffle: false,
  repeat: "off",
  shuffledQueue: [],

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),

  setQueue: (tracks, startIndex) => {
    const { shuffle } = get();
    const shuffled = shuffle ? shuffleArray(tracks) : tracks;
    set({
      queue: tracks,
      shuffledQueue: shuffled,
      queueIndex: startIndex,
      currentTrack: tracks[startIndex] ?? null,
    });
  },

 nextTrack: () => {
  const { shuffledQueue, queue, queueIndex, shuffle, repeat } = get();
  const activeQueue = shuffle ? shuffledQueue : queue;

  if (repeat === "one") {
    const current = activeQueue[queueIndex];
    set({ currentTrack: { ...current } });
    return;
  }

  const nextIndex = queueIndex + 1;

  if (nextIndex < activeQueue.length) {
    set({ queueIndex: nextIndex, currentTrack: activeQueue[nextIndex] });
  } else if (repeat === "all") {
    set({ queueIndex: 0, currentTrack: activeQueue[0] });
  } else if (shuffle) {
    // Reshuffle and start again
    const newShuffled = shuffleArray(queue);
    set({ shuffledQueue: newShuffled, queueIndex: 0, currentTrack: newShuffled[0] });
  } else {
    set({ isPlaying: false });
  }
},

  previousTrack: () => {
    const { shuffledQueue, queue, queueIndex, shuffle } = get();
    const activeQueue = shuffle ? shuffledQueue : queue;
    const prevIndex = queueIndex - 1;
    if (prevIndex >= 0) {
      set({ queueIndex: prevIndex, currentTrack: activeQueue[prevIndex] });
    }
  },

  toggleShuffle: () => {
    const { shuffle, queue } = get();
    const newShuffle = !shuffle;
    set({
      shuffle: newShuffle,
      shuffledQueue: newShuffle ? shuffleArray(queue) : queue,
    });
  },

  toggleRepeat: () => {
    const { repeat } = get();
    const next: RepeatMode =
      repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
    set({ repeat: next });
  },
}));