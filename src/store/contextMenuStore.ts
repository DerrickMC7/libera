import { create } from "zustand";
import { Track } from "../types/track";

interface ContextMenuStore {
  track: Track | null;
  x: number;
  y: number;
  playlistId: number | null;
  show: (track: Track, x: number, y: number, playlistId?: number) => void;
  hide: () => void;
}

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
  track: null,
  x: 0,
  y: 0,
  playlistId: null,
  show: (track, x, y, playlistId) => set({ track, x, y, playlistId: playlistId ?? null }),
  hide: () => set({ track: null, playlistId: null }),
}));
