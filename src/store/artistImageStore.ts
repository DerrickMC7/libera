import { create } from "zustand";

interface ArtistImageState {
  isDownloading: boolean;
  completed: number;
  total: number;
  currentArtist: string;
  startDownload: (total: number) => void;
  setProgress: (completed: number, total: number, current: string) => void;
  finishDownload: () => void;
}

export const useArtistImageStore = create<ArtistImageState>((set) => ({
  isDownloading: false,
  completed: 0,
  total: 0,
  currentArtist: "",
  startDownload: (total) => set({ isDownloading: true, completed: 0, total, currentArtist: "" }),
  setProgress: (completed, total, current) => set({ completed, total, currentArtist: current }),
  finishDownload: () => set({ isDownloading: false, completed: 0, total: 0, currentArtist: "" }),
}));
