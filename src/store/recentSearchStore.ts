import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RecentSearchState {
  searches: string[];
  add: (s: string) => void;
  remove: (s: string) => void;
  clear: () => void;
}

export const useRecentSearchStore = create<RecentSearchState>()(
  persist(
    (set, get) => ({
      searches: [],
      add: (s) => {
        const trimmed = s.trim();
        if (trimmed.length < 2) return;
        const rest = get().searches.filter((x) => x.toLowerCase() !== trimmed.toLowerCase());
        set({ searches: [trimmed, ...rest].slice(0, 8) });
      },
      remove: (s) => set({ searches: get().searches.filter((x) => x !== s) }),
      clear: () => set({ searches: [] }),
    }),
    { name: "libera-recent-searches" }
  )
);
