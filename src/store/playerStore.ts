import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { Track } from "../types/track";

// zustand/persist writes synchronously to localStorage on EVERY store update.
// Volume changes arrive at input-event rate while the slider is dragged, and
// each synchronous write stalls the main thread — which the audio pipeline
// feels as crackle. Coalesce writes into one trailing save instead.
const debouncedStorage: StateStorage = (() => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: string } | null = null;
  const flush = () => {
    if (pending) { localStorage.setItem(pending.name, pending.value); pending = null; }
  };
  window.addEventListener("beforeunload", flush);
  return {
    getItem: (name) => localStorage.getItem(name),
    removeItem: (name) => localStorage.removeItem(name),
    setItem: (name, value) => {
      pending = { name, value };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; flush(); }, 300);
    },
  };
})();

type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  queue: Track[];
  queueIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  shuffledQueue: Track[];
  manualQueuePaths: string[];
  // True while the queue is an ordered genre-map "path transition" (one song per genre,
  // in order). Lets the UI warn before shuffle scrambles it, and keep the path tab in
  // sync. Cleared whenever a normal queue replaces it.
  transitionActive: boolean;
  // Actions
  setCurrentTrack: (track: Track) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setQueue: (tracks: Track[], startIndex: number) => void;
  setQueueLazy: (paths: string[], startIndex: number, seed: Track) => void;
  hydrateTracks: (tracks: Track[]) => void;
  nextTrack: () => void;
  previousTrack: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  jumpToTrack: (absIdx: number) => void;
  playFromQueue: (absIdx: number) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (absIdx: number) => void;
  removeTrackEverywhere: (path: string) => void;
  reorderQueue: (fromAbsIdx: number, toAbsIdx: number) => void;
  closePlayer: () => void;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A path-only placeholder for the lazy library queue. Has every Track field so it
// satisfies the type and renders safely (blank metadata) until hydrated; `lazy` marks
// it for hydration. Playback only ever reads `path`, so a placeholder plays fine.
function placeholderTrack(path: string): Track {
  return {
    path, title: "", artist: "", album: "", album_artist: "", genre: "",
    year: null, track_number: null, track_total: null, disc_number: null, disc_total: null,
    duration_secs: 0, bitrate: null, sample_rate: null, channels: null, file_size: 0,
    mbid: null, replay_gain_track: null, replay_gain_album: null, lazy: true,
  };
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
  isMuted: false,
  queue: [],
  queueIndex: 0,
  shuffle: false,
  repeat: "off",
  shuffledQueue: [],
  manualQueuePaths: [],
  transitionActive: false,

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
  closePlayer: () => set({ currentTrack: null, isPlaying: false, queue: [], shuffledQueue: [], queueIndex: 0, manualQueuePaths: [], transitionActive: false }),

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
      transitionActive: false,
    });
  },

  // Like setQueue, but the queue is built from an ordered path list (the whole
  // library) without paying to serialize every track's metadata. The clicked
  // `seed` is placed (fully hydrated) at startIndex; all other slots are path-only
  // placeholders that hydrate lazily. Mirrors setQueue's shuffle handling.
  setQueueLazy: (paths, startIndex, seed) => {
    const { shuffle } = get();
    const full: Track[] = paths.map((p, i) => (i === startIndex ? seed : placeholderTrack(p)));
    let shuffled: Track[];
    if (shuffle) {
      const before = full.slice(0, startIndex + 1);
      const after  = shuffleArray(full.slice(startIndex + 1));
      shuffled = [...before, ...after];
    } else {
      shuffled = full;
    }
    set({
      queue: full,
      shuffledQueue: shuffled,
      queueIndex: startIndex,
      currentTrack: full[startIndex] ?? seed,
      manualQueuePaths: [],
      transitionActive: false,
    });
  },

  // Replace path-only placeholders with their hydrated metadata, in place, across
  // the queue / shuffled queue / current track. No-op for already-hydrated entries,
  // and returns the same references when nothing changed so subscribers don't re-render.
  hydrateTracks: (tracks) => {
    if (tracks.length === 0) return;
    const map = new Map(tracks.map((t) => [t.path, t]));
    const patch = (arr: Track[]): Track[] => {
      let changed = false;
      const next = arr.map((t) => {
        if (t.lazy) { const h = map.get(t.path); if (h) { changed = true; return h; } }
        return t;
      });
      return changed ? next : arr;
    };
    const { queue, shuffledQueue, currentTrack } = get();
    const newQueue = patch(queue);
    // shuffledQueue shares the queue reference when shuffle is off — patch once.
    const newShuffled = shuffledQueue === queue ? newQueue : patch(shuffledQueue);
    const newCurrent = currentTrack?.lazy ? (map.get(currentTrack.path) ?? currentTrack) : currentTrack;
    if (newQueue === queue && newShuffled === shuffledQueue && newCurrent === currentTrack) return;
    set({ queue: newQueue, shuffledQueue: newShuffled, currentTrack: newCurrent });
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
    } else if (repeat === "off") {
      set({ isPlaying: false });
      return;
    } else if (shuffle) {
      // repeat === "all" + shuffle: reshuffle and loop, keeping any remaining
      // manually-queued tracks pinned at their positions.
      newShuffled = smartShuffle(queue, -1, manualQueuePaths);
      nextIndex = 0;
    } else {
      // repeat === "all": loop to start
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
    const { shuffle, queue, queueIndex, manualQueuePaths, currentTrack } = get();
    const newShuffle = !shuffle;
    const newShuffled = newShuffle
      ? smartShuffle(queue, queueIndex, manualQueuePaths)
      : queue;
    // The active queue changes (queue ↔ shuffledQueue), so realign queueIndex to where
    // the current track actually sits in the new active order — otherwise the "now
    // playing" marker and next/prev drift off the real track (visible in the queue tab).
    const newActive = newShuffle ? newShuffled : queue;
    let newIndex = queueIndex;
    if (currentTrack) {
      const i = newActive.findIndex((t) => t.path === currentTrack.path);
      if (i >= 0) newIndex = i;
    }
    set({ shuffle: newShuffle, shuffledQueue: newShuffled, queueIndex: newIndex });
  },

  toggleRepeat: () => {
    const { repeat } = get();
    const next: RepeatMode = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
    set({ repeat: next });
  },

  jumpToTrack: (absIdx: number) => {
    const { queue, shuffledQueue, shuffle } = get();
    const activeQueue = shuffle ? shuffledQueue : queue;
    const track = activeQueue[absIdx];
    if (!track) return;
    set({ queueIndex: absIdx, currentTrack: track });
  },

  // Move a future track to play immediately after the current one,
  // preserving all other tracks (including manual ones) as upcoming.
  playFromQueue: (absIdx: number) => {
    const { queue, shuffledQueue, queueIndex, shuffle, manualQueuePaths } = get();
    const activeQueue = shuffle ? shuffledQueue : queue;
    const track = activeQueue[absIdx];
    if (!track || absIdx <= queueIndex) return;

    const insertAt = queueIndex + 1;
    const newManualPaths = removeFirstOccurrence(manualQueuePaths, track.path);

    // Already the very next track — just advance
    if (absIdx === insertAt) {
      set({ queueIndex: insertAt, currentTrack: track, manualQueuePaths: newManualPaths });
      return;
    }

    const moveIn = (arr: Track[], from: number) => {
      const a = [...arr];
      const [moved] = a.splice(from, 1);
      a.splice(insertAt, 0, moved);
      return a;
    };

    if (shuffle) {
      const newShuffled = moveIn(shuffledQueue, absIdx);
      const mirrorIdx = queue.findIndex((t, i) => i > queueIndex && t.path === track.path);
      const newQueue = mirrorIdx !== -1 ? moveIn(queue, mirrorIdx) : queue;
      set({ queue: newQueue, shuffledQueue: newShuffled, queueIndex: insertAt, currentTrack: track, manualQueuePaths: newManualPaths });
    } else {
      const newQueue = moveIn(queue, absIdx);
      set({ queue: newQueue, shuffledQueue: newQueue, queueIndex: insertAt, currentTrack: track, manualQueuePaths: newManualPaths });
    }
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

  removeFromQueue: (absIdx: number) => {
    const { queue, shuffledQueue, queueIndex, shuffle, manualQueuePaths } = get();
    const activeQueue = shuffle ? shuffledQueue : queue;
    const trackPath = activeQueue[absIdx]?.path;
    if (!trackPath) return;

    const cut = (q: Track[], i: number) => [...q.slice(0, i), ...q.slice(i + 1)];

    let newQueue: Track[];
    let newShuffled: Track[];

    if (shuffle) {
      newShuffled = cut(shuffledQueue, absIdx);
      const mirror = queue.findIndex((t, i) => i > queueIndex && t.path === trackPath);
      newQueue = mirror !== -1 ? cut(queue, mirror) : queue;
    } else {
      newQueue = cut(queue, absIdx);
      newShuffled = newQueue;
    }

    set({
      queue: newQueue,
      shuffledQueue: newShuffled,
      manualQueuePaths: removeFirstOccurrence(manualQueuePaths, trackPath),
    });
  },

  // Remove every copy of `path` from the queue (both orders) and the manual list —
  // used when a track is removed from the library. If the removed track is currently
  // playing, advance to the track that followed it; if it was the last one, settle on
  // the new last track and pause; if the queue becomes empty, stop.
  removeTrackEverywhere: (path: string) => {
    const { queue, shuffledQueue, shuffle, queueIndex, currentTrack, manualQueuePaths } = get();
    const active = shuffle ? shuffledQueue : queue;
    const newManual = manualQueuePaths.filter((p) => p !== path);
    if (!active.some((t) => t.path === path)) {
      if (newManual.length !== manualQueuePaths.length) set({ manualQueuePaths: newManual });
      return;
    }

    const newActive = active.filter((t) => t.path !== path);
    if (newActive.length === 0) {
      set({ queue: [], shuffledQueue: [], queueIndex: 0, currentTrack: null, isPlaying: false, manualQueuePaths: [] });
      return;
    }

    // How many removed copies sat before the current index — the index shifts left by that much.
    let removedBefore = 0;
    for (let i = 0; i < queueIndex && i < active.length; i++) {
      if (active[i].path === path) removedBefore++;
    }
    const followerIdx = queueIndex - removedBefore; // post-removal slot of the track after current

    const wasCurrent = currentTrack?.path === path;
    let newIndex: number;
    let stop = false;
    if (wasCurrent) {
      if (followerIdx <= newActive.length - 1) {
        newIndex = followerIdx;            // advance to the next track
      } else {
        newIndex = newActive.length - 1;   // current was the last → settle on new last, paused
        stop = true;
      }
    } else {
      newIndex = Math.min(Math.max(0, followerIdx), newActive.length - 1); // keep current in place
    }
    const newCurrent = wasCurrent ? newActive[newIndex] : currentTrack;

    const newQueue = shuffle ? queue.filter((t) => t.path !== path) : newActive;
    const newShuffled = shuffle ? newActive : newQueue;

    set({
      queue: newQueue,
      shuffledQueue: newShuffled,
      queueIndex: newIndex,
      currentTrack: newCurrent,
      manualQueuePaths: newManual,
      ...(stop ? { isPlaying: false } : {}),
    });
  },

  reorderQueue: (fromAbsIdx: number, toAbsIdx: number) => {
    if (fromAbsIdx === toAbsIdx) return;
    const { queue, shuffledQueue, shuffle } = get();
    const src = shuffle ? shuffledQueue : queue;
    const arr = [...src];
    const [moved] = arr.splice(fromAbsIdx, 1);
    // When moving down, original toAbsIdx shifted up by one after the removal
    arr.splice(fromAbsIdx < toAbsIdx ? toAbsIdx - 1 : toAbsIdx, 0, moved);
    if (shuffle) {
      set({ shuffledQueue: arr });
    } else {
      set({ queue: arr, shuffledQueue: arr });
    }
  },
}),
{
  name: "libera-player",
  storage: createJSONStorage(() => debouncedStorage),
  partialize: (s) => ({ volume: s.volume, isMuted: s.isMuted, shuffle: s.shuffle, repeat: s.repeat }),
}
));
