import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Track } from "../types/track";

interface RecentlyPlayedState {
  tracks: Track[];
  add: (track: Track) => void;
  clear: () => void;
}

export const useRecentlyPlayedStore = create<RecentlyPlayedState>()(
  persist(
    (set, get) => ({
      tracks: [],
      add: (track) => {
        const rest = get().tracks.filter((t) => t.path !== track.path);
        set({ tracks: [track, ...rest].slice(0, 20) });
      },
      clear: () => set({ tracks: [] }),
    }),
    { name: "libera-recently-played" }
  )
);
