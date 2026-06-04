import { create } from "zustand";
import { persist } from "zustand/middleware";
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
  manualQueuePaths: string[];
  // Actions
  setCurrentTrack: (track: Track) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setQueue: (tracks: Track[], startIndex: number) => void;
  nextTrack: () => void;
  previousTrack: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function removeFirstOccurrence(arr: string[], value: string): string[] {
  const idx = arr.indexOf(value);
  if (idx === -1) return arr;
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

// Removes the first SYSTEM copy of `path` found after `fromIdx`.
// Manually-queued copies (tracked in manualPaths) are skipped over so the
// user can intentionally queue the same song multiple times without their
// own entries being eaten.
function removeFirstSystemCopy(
  q: Track[],
  fromIdx: number,
  path: string,
  manualPaths: string[],
): Track[] {
  // How many manual copies of this path already exist (before this new addition)
  const manualCount = manualPaths.filter(p => p === path).length;
  let manualSeen = 0;
  for (let i = fromIdx + 1; i < q.length; i++) {
    if (q[i].path !== path) continue;
    if (manualSeen < manualCount) {
      manualSeen++; // this slot belongs to an existing manual entry — skip it
      continue;
    }
    // First system copy found — remove it
    return [...q.slice(0, i), ...q.slice(i + 1)];
  }
  return q; // no system copy found, queue unchanged
}

// Returns the index AFTER the last manually-queued track in the future portion of `q`.
// Falls back to queueIndex + 1 (right after current) when no manual tracks exist yet.
function insertAfterManual(q: Track[], queueIndex: number, manualPaths: string[]): number {
  const manualSet = new Set(manualPaths);
  let last = queueIndex; // will become `last + 1` as the insert point
  for (let i = queueIndex + 1; i < q.length; i++) {
    if (manualSet.has(q[i].path)) last = i;
  }
  return last + 1;
}

// Shuffle future tracks while:
//  • keeping everything up to and including currentIdx unchanged
//  • keeping manually-queued tracks pinned at their original future positions
//  • shuffling only the auto tracks around them
function smartShuffle(queue: Track[], currentIdx: number, manualPaths: string[]): Track[] {
  const before = queue.slice(0, currentIdx + 1);
  const future = queue.slice(currentIdx + 1);

  const manualSet = new Set(manualPaths);

  // Separate future into pinned (manual) slots and free (auto) tracks
  const isPinned = future.map(t => manualSet.has(t.path));
  const autoTracks = future.filter((_, i) => !isPinned[i]);
  const shuffledAuto = shuffleArray(autoTracks);

  let autoIdx = 0;
  const shuffledFuture = future.map((t, i) => (isPinned[i] ? t : shuffledAuto[autoIdx++]));

  return [...before, ...shuffledFuture];
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
  currentTrack: null,
  isPlaying: false,
  volume: 0.25,
  queue: [],
  queueIndex: 0,
  shuffle: false,
  repeat: "off",
  shuffledQueue: [],
  manualQueuePaths: [],

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),

  setQueue: (tracks, startIndex) => {
    const { shuffle } = get();
    // When shuffle is on, keep the selected starting track in place and shuffle the rest
    let shuffled: Track[];
    if (shuffle) {
      const before = tracks.slice(0, startIndex + 1);
      const after  = shuffleArray(tracks.slice(startIndex + 1));
      shuffled = [...before, ...after];
    } else {
      shuffled = tracks;
    }
    set({
      queue: tracks,
      shuffledQueue: shuffled,
      queueIndex: startIndex,
      currentTrack: tracks[startIndex] ?? null,
      manualQueuePaths: [],
    });
  },

  nextTrack: () => {
    const { shuffledQueue, queue, queueIndex, shuffle, repeat, manualQueuePaths } = get();
    const activeQueue = shuffle ? shuffledQueue : queue;

    if (repeat === "one") {
      set({ currentTrack: { ...activeQueue[queueIndex] } });
      return;
    }

    let nextIndex: number;
    let newShuffled = shuffledQueue;

    if (queueIndex + 1 < activeQueue.length) {
      nextIndex = queueIndex + 1;
    } else if (shuffle) {
      // Loop: reshuffle future only (start from index 0)
      newShuffled = smartShuffle(queue, -1, []);
      nextIndex = 0;
    } else {
      nextIndex = 0;
    }

    const nextTrack = (shuffle ? newShuffled : queue)[nextIndex];
    set({
      queueIndex: nextIndex,
      currentTrack: nextTrack ?? null,
      shuffledQueue: newShuffled,
      manualQueuePaths: nextTrack
        ? removeFirstOccurrence(manualQueuePaths, nextTrack.path)
        : manualQueuePaths,
    });
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
    const { shuffle, queue, queueIndex, manualQueuePaths } = get();
    const newShuffle = !shuffle;
    set({
      shuffle: newShuffle,
      shuffledQueue: newShuffle
        ? smartShuffle(queue, queueIndex, manualQueuePaths)
        : queue,
    });
  },

  toggleRepeat: () => {
    const { repeat } = get();
    const next: RepeatMode = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
    set({ repeat: next });
  },

  playNext: (track: Track) => {
    const { queue, shuffledQueue, queueIndex, shuffle, manualQueuePaths } = get();
    // Remove the first system copy if one exists (skip past existing manual copies)
    const cleanQueue    = removeFirstSystemCopy(queue, queueIndex, track.path, manualQueuePaths);
    const cleanShuffled = removeFirstSystemCopy(shuffledQueue, queueIndex, track.path, manualQueuePaths);
    const insertIdx = queueIndex + 1;
    const newQueue    = [...cleanQueue.slice(0, insertIdx), track, ...cleanQueue.slice(insertIdx)];
    const newShuffled = shuffle
      ? [...cleanShuffled.slice(0, insertIdx), track, ...cleanShuffled.slice(insertIdx)]
      : newQueue;
    set({
      queue: newQueue,
      shuffledQueue: newShuffled,
      manualQueuePaths: [...manualQueuePaths, track.path],
    });
  },

  addToQueue: (track: Track) => {
    const { queue, shuffledQueue, queueIndex, manualQueuePaths } = get();
    // Remove the first system copy if one exists (skip past existing manual copies)
    const cleanQueue    = removeFirstSystemCopy(queue, queueIndex, track.path, manualQueuePaths);
    const cleanShuffled = removeFirstSystemCopy(shuffledQueue, queueIndex, track.path, manualQueuePaths);
    // Insert after the last user-added track so user section stays before system tracks
    const idxInQueue    = insertAfterManual(cleanQueue, queueIndex, manualQueuePaths);
    const idxInShuffled = insertAfterManual(cleanShuffled, queueIndex, manualQueuePaths);
    set({
      queue:            [...cleanQueue.slice(0, idxInQueue),    track, ...cleanQueue.slice(idxInQueue)],
      shuffledQueue:    [...cleanShuffled.slice(0, idxInShuffled), track, ...cleanShuffled.slice(idxInShuffled)],
      manualQueuePaths: [...manualQueuePaths, track.path],
    });
  },
}),
{
  name: "libera-player",
  partialize: (s) => ({ volume: s.volume, shuffle: s.shuffle, repeat: s.repeat }),
}
));
